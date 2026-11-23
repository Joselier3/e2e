/** The `request` fixture: HTTP calls from a test, each one a step bounded by the test's budget. */

import { expectationBrand } from '../internal/brands.ts';
import { ConfigurationError, errorMessage, TestError } from '../internal/errors.ts';
import { stepTimeout, withAbort, withScopedBudget } from '../internal/time.ts';
import type { NormalizedBaseUrl } from '../internal/urls.ts';
import type { APIRequest, APIRequestFetchOptions, APIRequestOptions, APIResponse, APIResponseExpectation } from '../types.ts';
import type { AttemptEnvironment } from './fixtures.ts';

/** What one call runs under, read when the call starts. */
export interface RequestWiring {
  readonly environment: AttemptEnvironment;
  /** The action timeout in milliseconds, read when each call starts. */
  readonly actionTimeout: () => number;
}

/** Builds the `request` fixture over one attempt. */
export function createRequest(wiring: RequestWiring): APIRequest {
  const call = (method: string) => (url: string, options?: APIRequestOptions) =>
    send(wiring, `request.${method.toLowerCase()}`, () => method, url, options);
  return {
    fetch: (url, options) => send(wiring, 'request.fetch', () => methodOf(options), url, options),
    get: call('GET'),
    post: call('POST'),
    put: call('PUT'),
    patch: call('PATCH'),
    delete: call('DELETE'),
    head: call('HEAD'),
  };
}

/** One call, checked before it is sent: its step label, and what goes out or why it cannot. */
type Prepared = { readonly label: string } & (
  | { readonly url: URL; readonly init: RequestInit; readonly timeoutMs: number | undefined }
  | { readonly refused: unknown }
);

/**
 * Sends one request inside a `resource` step and returns its buffered
 * response. A refused call still opens the step and rejects inside it; its
 * label is `METHOD /path` once the method and URL passed, else empty, so
 * nothing a refused URL holds is shown.
 */
function send(
  wiring: RequestWiring,
  api: string,
  readMethod: () => string,
  input: unknown,
  options: APIRequestOptions | undefined,
): Promise<APIResponse> {
  const { environment } = wiring;
  const prepared = prepare(api, readMethod, input, options, environment.target.app.base);
  return environment.steps.run('resource', api, prepared.label, () => {
    if ('refused' in prepared) return Promise.reject(prepared.refused);
    const { url, init, label } = prepared;
    const timeoutMs = prepared.timeoutMs ?? wiring.actionTimeout();
    const { signal } = environment.budget;
    return withAbort(
      () => withScopedBudget(
        timeoutMs,
        signal,
        () => new TestError('ACTION_FAILED', `${label} exceeded its timeout of ${timeoutMs}ms`),
        (scoped) => exchange(url, init, label, scoped),
      ),
      signal,
      () => new TestError('CANCELLED', `${label} cancelled`),
    );
  });
}

/** Checks the method and URL of one call, then its options. */
function prepare(
  api: string,
  readMethod: () => string,
  input: unknown,
  options: APIRequestOptions | undefined,
  base: NormalizedBaseUrl | undefined,
): Prepared {
  let method: string;
  let url: URL;
  try {
    method = readMethod();
    url = requestUrl(input, base);
  } catch (refused) {
    return { label: '', refused };
  }
  const label = `${method} ${shownUrl(url, base)}`;
  try {
    const init = requestInit(method, options);
    return { label, url, init, timeoutMs: stepTimeout(options?.timeout, api) };
  } catch (refused) {
    return { label, refused };
  }
}

/** The fetch and the body read, both under `signal`; a network failure is `ACTION_FAILED` naming the call. */
async function exchange(url: URL, init: RequestInit, label: string, signal: AbortSignal): Promise<APIResponse> {
  try {
    const response = await fetch(url, { ...init, signal });
    const body = new Uint8Array(await response.arrayBuffer());
    return apiResponse(response, body, label);
  } catch (cause) {
    // An abort is the budget's or the timeout's: the wrappers above report it.
    if (signal.aborted) throw cause;
    throw new TestError('ACTION_FAILED', `${label} failed: ${networkReason(cause)}`, { cause });
  }
}

/** Why fetch failed, from the cause undici puts under its generic `fetch failed`. */
function networkReason(cause: unknown): string {
  const inner = cause instanceof Error && cause.cause !== undefined ? cause.cause : cause;
  return errorMessage(inner);
}

/** The method `request.fetch` sends: `options.method` upper-cased, GET when absent. */
function methodOf(options: APIRequestFetchOptions | undefined): string {
  const method = options?.method;
  if (method === undefined) return 'GET';
  if (typeof method !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method)) {
    throw new TestError('INVALID_ARGUMENT', 'request.fetch: method must be an HTTP method name, such as "GET"');
  }
  const upper = method.toUpperCase();
  if (UNSENDABLE_METHODS.has(upper)) {
    throw new TestError('INVALID_ARGUMENT', `request.fetch: ${upper} is not supported; CONNECT, TRACE, and TRACK cannot be sent`);
  }
  return upper;
}

/** The methods Node's fetch refuses to send. */
const UNSENDABLE_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK']);

/**
 * The URL a call goes to: a path resolved against the app URL as `app.open`
 * resolves one, or an absolute one. Only http(s) passes, so unlike a
 * navigation, `about:blank` is refused too. No refusal quotes the input.
 */
function requestUrl(input: unknown, base: NormalizedBaseUrl | undefined): URL {
  if (typeof input !== 'string' || input === '') {
    throw new TestError('INVALID_ARGUMENT', 'request: url must be a non-empty string, a path or an absolute http(s) URL');
  }
  if (base === undefined && !URL.canParse(input)) {
    throw new ConfigurationError(
      'APP_URL_REQUIRED',
      'request: a path needs an app URL to resolve against; the target declares no app.url, so pass an absolute URL',
    );
  }
  let url: URL;
  try {
    url = new URL(input, base?.href);
  } catch {
    throw new ConfigurationError('POLICY_DENIED', 'request: malformed URL');
  }
  if (url.username !== '' || url.password !== '') {
    throw new TestError('INVALID_ARGUMENT', 'request: a URL must not contain credentials; send them in headers');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigurationError('POLICY_DENIED', `request: forbidden URL scheme: ${url.protocol}`);
  }
  return url;
}

/** The URL as a step label shows it: the path on the app's origin, the origin too elsewhere; never the query. */
function shownUrl(url: URL, base: NormalizedBaseUrl | undefined): string {
  return url.origin === base?.origin ? url.pathname : `${url.origin}${url.pathname}`;
}

/** The fetch init for one call: its method, headers, and body. */
function requestInit(method: string, options: APIRequestOptions | undefined): RequestInit {
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw new TestError('INVALID_ARGUMENT', 'request: options must be an object');
  }
  const given: unknown = options?.headers;
  if (given !== undefined && (typeof given !== 'object' || given === null || Array.isArray(given))) {
    throw new TestError('INVALID_ARGUMENT', 'request: headers must be an object of header names to string values');
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(given ?? {})) {
    if (typeof value !== 'string') throw new TestError('INVALID_ARGUMENT', `request: header "${name}" must be a string`);
    try {
      headers.set(name, value);
    } catch {
      // The value is not quoted: it may be a credential.
      throw new TestError('INVALID_ARGUMENT', `request: header "${name}" has an invalid name or value`);
    }
  }
  const body = requestBody(options, headers);
  if (body !== undefined && (method === 'GET' || method === 'HEAD')) {
    throw new TestError('INVALID_ARGUMENT', `request: a ${method} request takes no body`);
  }
  return { method, headers, ...(body === undefined ? {} : { body }) };
}

/** The body of one call: `json` serialized, else `body` as given; content-type defaults to JSON for `json`. */
function requestBody(options: APIRequestOptions | undefined, headers: Headers): string | undefined {
  const json: unknown = options?.json;
  const raw = options?.body;
  if (json !== undefined && raw !== undefined) throw new TestError('INVALID_ARGUMENT', 'request: pass json or body, not both');
  if (raw !== undefined) {
    if (typeof raw !== 'string') throw new TestError('INVALID_ARGUMENT', 'request: body must be a string');
    return raw;
  }
  if (json === undefined) return undefined;
  let text: string | undefined;
  try {
    text = JSON.stringify(json);
  } catch {
    text = undefined;
  }
  if (typeof text !== 'string') throw new TestError('INVALID_ARGUMENT', 'request: json must be a JSON-serializable value');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return text;
}

/** A response whose body was read inside the call's step, with `toBeOK()` on `expect(response)`. */
function apiResponse(response: Response, body: Uint8Array, label: string): APIResponse {
  // fromEntries defines each name as its own property, `__proto__` included.
  const headers: Record<string, string> = Object.fromEntries([...response.headers].filter(([name]) => name !== 'set-cookie'));
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers['set-cookie'] = cookies.join('\n');
  const text = (): string => new TextDecoder().decode(body);
  const result = {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers,
    text: () => Promise.resolve(text()),
    // oxlint-disable-next-line e2e/no-unchecked-json -- public API: the caller names T, unknown by default
    json: async <T = unknown>() => JSON.parse(text()) as T,
  };
  return Object.defineProperty(result, expectationBrand, { enumerable: false, value: responseExpectation(result, label) }) as APIResponse;
}

/** `expect(response)`: `toBeOK()` and its negation. */
function responseExpectation(response: Pick<APIResponse, 'ok' | 'status' | 'statusText'>, label: string): APIResponseExpectation {
  const got = (): string => `${response.status}${response.statusText === '' ? '' : ` ${response.statusText}`}`;
  const not = {
    toBeOK(): void {
      if (response.ok) throw new TestError('ASSERTION_FAILED', `expected ${label} not to be OK, got ${got()}`);
    },
  };
  return {
    not,
    toBeOK(): void {
      if (!response.ok) throw new TestError('ASSERTION_FAILED', `expected ${label} to be OK (a 2xx status), got ${got()}`);
    },
  };
}
