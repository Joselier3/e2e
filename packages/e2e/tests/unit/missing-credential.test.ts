/** A provider request that had no key to send is the run-stopping MODEL_UNAVAILABLE naming the variable; a key the provider refused, and any error that is not the provider package's own, is left alone. */

import { APICallError, LoadAPIKeyError } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { AgentError } from '@e2e-dev/core/lib/agent/error';
import { loadAiSdk, type SdkLanguageModel } from '@e2e-dev/core/lib/agent/ai-sdk';
import { missingCredentialError, withMissingCredentialNamed } from '@e2e-dev/core/lib/agent/model/missing-credential';
import { failureHint, isUnservedModelError, unservedModelError } from '@e2e-dev/core/lib/agent/model/sdk';
import { createScriptedInstance } from '../helpers/scripted-model.ts';

/** What a provider package throws when it finds no key, before any request. */
function noKey(): LoadAPIKeyError {
  return new LoadAPIKeyError({ message: "OpenAI API key is missing. Pass it using the 'apiKey' parameter or the OPENAI_API_KEY environment variable." });
}

/** The gateway's own error, as its model instance throws it, with `headline` saying which case it is. */
function gatewayFailure(headline: string): Error {
  return Object.assign(new Error(`AI Gateway authentication failed: ${headline}\n\nProvide via 'apiKey' option or 'AI_GATEWAY_API_KEY' environment variable.`), {
    name: 'GatewayAuthenticationError',
    statusCode: 401,
  });
}

/** The same failure after `ai` rewrote it: one text for a missing key and a refused one. */
function rewrittenGatewayFailure(): Error {
  return Object.assign(new Error('Unauthenticated request to AI Gateway.\n\nTo authenticate, set the AI_GATEWAY_API_KEY environment variable with your API key.\n'), {
    name: 'GatewayAuthenticationError',
  });
}

/** A 401 from a provider that was sent a key. */
function refusedKey(): APICallError {
  return new APICallError({ message: 'Incorrect API key provided. Set OPENAI_API_KEY to a valid key.', url: 'https://api.openai.com/v1/responses', requestBodyValues: {}, statusCode: 401 });
}

describe('missingCredentialError', () => {
  it('names the variable the provider package reads when it is unset or blank, and how to go on without a model', () => {
    const error = missingCredentialError(noKey(), {});
    expect(error?.code).toBe('MODEL_UNAVAILABLE');
    expect(error?.message).toBe(
      'the model has no credential: OPENAI_API_KEY is not set, so no agent step can call the model. Set OPENAI_API_KEY, or pass the key where the model is constructed. Tests with no agent call, and agent.act steps that replay a recording, need no model: pass those test files to e2e run',
    );
    expect(missingCredentialError(noKey(), { OPENAI_API_KEY: '  ' })?.message).toContain('OPENAI_API_KEY is not set');
    expect(missingCredentialError(gatewayFailure('No authentication provided.'), {})?.message).toMatch(/^the model has no credential: AI_GATEWAY_API_KEY is not set/);
  });

  it('is the run-stopping error the fixture reports once, with no cause to carry a provider field out', () => {
    const error = missingCredentialError(noKey(), {});
    expect(isUnservedModelError(error)).toBe(true);
    expect(unservedModelError(error)).toBe(error);
    expect(error?.cause).toBeUndefined();
  });

  it('does not claim a variable is unset when it holds a value, and never quotes the value', () => {
    const message = missingCredentialError(new LoadAPIKeyError({ message: 'OpenAI API key must be a string. The value of the OPENAI_API_KEY environment variable is not a string.' }), {
      OPENAI_API_KEY: 'sk-live-4242424242',
    })?.message;
    expect(message).toMatch(/^the model has no credential: its provider package found no API key/);
    expect(message).not.toContain('OPENAI_API_KEY');
    expect(message).not.toContain('sk-live-4242424242');
  });

  it('leaves a key the provider refused alone, whatever the environment holds', () => {
    expect(missingCredentialError(gatewayFailure('Invalid API key or token.'), {})).toBeUndefined();
    expect(missingCredentialError(gatewayFailure('Invalid OIDC token.'), {})).toBeUndefined();
    expect(missingCredentialError(refusedKey(), {})).toBeUndefined();
  });

  it("leaves every error that is not the provider package's own alone, the same words included", () => {
    expect(missingCredentialError(rewrittenGatewayFailure(), {})).toBeUndefined();
    expect(missingCredentialError(new AgentError('ASSERTION_FAILED', 'the page shows "Authentication failed: No authentication provided" and asks for OPENAI_API_KEY'), {})).toBeUndefined();
    expect(missingCredentialError(Object.assign(new Error('Unauthorized: set ANTHROPIC_API_KEY'), { statusCode: 401 }), {})).toBeUndefined();
    expect(missingCredentialError('OPENAI_API_KEY is missing', {})).toBeUndefined();
  });
});

describe('withMissingCredentialNamed', () => {
  /** One generate call on a model that throws from `doGenerate`, behind the wrapper, resolving to what the call threw. */
  async function failureOf(doGenerate: () => Promise<unknown>): Promise<unknown> {
    const ai = await loadAiSdk();
    const model = withMissingCredentialNamed(ai, createScriptedInstance('scripted', 'keyless', doGenerate) as SdkLanguageModel);
    return ai.generateText({ model, prompt: 'hi', maxRetries: 0 }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
  }

  it('fails a request that had no key as the run-stopping error, through generateText', async () => {
    const failure = await failureOf(async () => {
      throw gatewayFailure('No authentication provided.');
    });
    expect(isUnservedModelError(failure)).toBe(true);
    expect((failure as AgentError).code).toBe('MODEL_UNAVAILABLE');
  });

  it('passes a refused key through, which still reads as a rejected credential', async () => {
    const failure = await failureOf(async () => {
      throw refusedKey();
    });
    expect(unservedModelError(failure)).toBeUndefined();
    expect(failureHint(failure)).toContain('the provider rejected the credential');
  });
});
