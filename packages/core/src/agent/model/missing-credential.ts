/**
 * A provider request that had no key to send, told apart from a key the
 * provider refused. Read from the provider package's own error as the model
 * instance throws it: `ai` rewrites a gateway authentication failure into one
 * text for both cases before a caller of `generateText` sees it.
 */

import { markUnservedModel } from '../../internal/unserved-model.ts';
import type { AiSdk, SdkLanguageModel } from '../ai-sdk.ts';
import { AgentError } from '../error.ts';

/** A name shaped like an environment variable, as a provider's message spells it. */
const VARIABLE_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

/**
 * True for the two errors raised before any request left: the AI SDK's own
 * for a provider package that found no key, and the Vercel AI Gateway's when
 * it resolved neither a key nor an OIDC token. A key the gateway sent and
 * the server refused reads "Invalid API key or token" instead.
 */
function foundNoCredential(failure: Error): boolean {
  if (failure.name === 'AI_LoadAPIKeyError') return true;
  return failure.name === 'GatewayAuthenticationError' && failure.message.includes('No authentication provided');
}

/**
 * The run-stopping `MODEL_UNAVAILABLE` for a provider error raised because
 * no credential was there to send, naming the variable the provider's text
 * names when it is unset here; undefined for any other failure, a refused
 * key included. Carries no cause and never a value.
 */
export function missingCredentialError(
  failure: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AgentError | undefined {
  if (!(failure instanceof Error) || !foundNoCredential(failure)) return undefined;
  const named = VARIABLE_NAME.exec(failure.message)?.[0];
  const unset = named !== undefined && (env[named] ?? '').trim() === '';
  const explanation =
    `the model has no credential: ${unset ? `${named} is not set` : 'its provider package found no API key'}, so no agent step can call the model. ` +
    `${unset ? `Set ${named}` : 'Set the variable the provider package reads'}, or pass the key where the model is constructed. ` +
    'Tests with no agent call, and agent.act steps that replay a recording, need no model: pass those test files to e2e run';
  return markUnservedModel(new AgentError('MODEL_UNAVAILABLE', explanation), explanation);
}

/** `model` with a request that had no credential to send failing as `missingCredentialError`, which no transport retry repeats. */
export function withMissingCredentialNamed(ai: AiSdk, model: SdkLanguageModel): SdkLanguageModel {
  return ai.wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        try {
          return await doGenerate();
        } catch (cause) {
          throw missingCredentialError(cause) ?? cause;
        }
      },
    },
  });
}
