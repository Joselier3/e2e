/** The `request` fixture: HTTP calls from a test and its hooks, each one a step on the running budget. */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineEngine } from '@e2e-dev/core/lib/engine/index';
import type { E2EConfig } from '../../src/index.ts';
import { createFakeEngine } from '../helpers/fake-engine.ts';
import { freePort } from '../helpers/free-port.ts';
import { hookLog, LOG_MODULE } from '../helpers/hook-log.ts';
import { assertValidReport } from '../helpers/report-schema.ts';
import { resultByTitle, runProject } from '../helpers/run-project.ts';

/** A small JSON API on loopback; `closed` lists the hanging calls whose connection the client dropped. */
interface Api {
  readonly url: string;
  readonly closed: string[];
  /** Every path the server was asked for. */
  readonly paths: string[];
  close(): Promise<void>;
}

async function startApi(): Promise<Api> {
  const closed: string[] = [];
  const paths: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    paths.push(url.pathname);
    if (url.pathname === '/api/orders' && request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ received: JSON.parse(body) as unknown, contentType: request.headers['content-type'], query: url.search, auth: request.headers.authorization ?? null }));
      });
      return;
    }
    if (url.pathname === '/api/cookies') {
      response.setHeader('set-cookie', ['a=1', 'b=2']);
      response.end('ok');
      return;
    }
    if (url.pathname === '/api/stall-body') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('partial');
      response.on('close', () => closed.push(url.searchParams.get('who') ?? 'stall'));
      return;
    }
    if (url.pathname === '/api/hang') {
      response.on('close', () => closed.push(url.searchParams.get('who') ?? 'hang'));
      return;
    }
    if (url.pathname === '/api/ok') {
      response.end('ok');
      return;
    }
    if (url.pathname === '/api/proto') {
      response.setHeader('__proto__', 'kept');
      response.end('ok');
      return;
    }
    response.writeHead(404, 'Not Found');
    // The method that arrived, so a test can tell it from the one its label names.
    response.end(request.method);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    closed,
    paths,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

let api: Api;
beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.close(); });

/** One fake-engine target whose app is the API. */
function onApi(extra: Partial<E2EConfig> = {}): Partial<E2EConfig> {
  return { targets: [{ name: 'fake', platform: 'fake', engine: createFakeEngine().engine, app: { url: api.url } }], ...extra };
}

describe('request fixture', () => {
  it('sends calls against the app URL, records each as a step, and returns a WebResponse', async () => {
    const file = `import { test, expect } from 'e2e';

test('creates an order', async ({ request }) => {
  const created = await request.post('/api/orders?ref=r1', { json: { sku: 'A1' }, headers: { authorization: 'Bearer t' } });
  expect(created.status).toBe(201);
  expect(created.url).toBe('${api.url}/api/orders?ref=r1');
  expect(await created.json()).toEqual({ received: { sku: 'A1' }, contentType: 'application/json', query: '?ref=r1', auth: 'Bearer t' });
  const cookies = await request.get('/api/cookies');
  expect(cookies.headers['set-cookie']).toBe('a=1\\nb=2');
  expect(Object.hasOwn((await request.get('/api/proto')).headers, '__proto__')).toBe(true);
  expect(await cookies.text()).toBe('ok');
  const bytes = await cookies.body();
  expect(Buffer.isBuffer(bytes) && bytes.toString('utf8')).toBe('ok');
  const missing = await request.fetch('/api/missing', { method: 'delete' });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toBe('DELETE');
});
`;
    const { outcome } = await runProject({ 'tests/api.e2e.ts': file }, { config: onApi() });
    assertValidReport(outcome.report);
    const created = resultByTitle(outcome, 'creates an order');
    expect(created.status, JSON.stringify(created.attempts[0]?.error)).toBe('passed');
    expect(created.attempts[0]!.steps.map(({ kind, api: name, label, status }) => ({ kind, api: name, label, status }))).toEqual([
      { kind: 'resource', api: 'request.post', label: 'POST /api/orders', status: 'passed' },
      { kind: 'resource', api: 'request.get', label: 'GET /api/cookies', status: 'passed' },
      { kind: 'resource', api: 'request.get', label: 'GET /api/proto', status: 'passed' },
      { kind: 'resource', api: 'request.fetch', label: 'DELETE /api/missing', status: 'passed' },
    ]);
  });

  it('aborts a call at the action timeout, and an afterEach call runs on its own budget after the body timed out', async () => {
    const file = `import { test } from 'e2e';
import { log } from './log.ts';

test('hangs past the action timeout', async ({ request }) => {
  await request.get('/api/hang?who=action');
});

test('stalls in the body past its own timeout', async ({ request }) => {
  await request.get('/api/stall-body?who=body', { timeout: 300 });
});

test('hangs past its own timeout', async ({ request }) => {
  await request.get('/api/hang?who=own', { timeout: 300 });
});

test.describe('cleanup', () => {
  test.afterEach(async ({ request }) => {
    log('afterEach:' + (await request.get('/api/ok')).status);
  });
  test('hangs past the test timeout', { timeout: 400 }, async ({ request }) => {
    await request.get('/api/hang?who=deadline');
  });
});
`;
    const log = hookLog('request-fixture');
    const { outcome } = await runProject({ 'tests/log.ts': LOG_MODULE, 'tests/hang.e2e.ts': file }, { config: onApi({ actionTimeout: 1_500 }) });
    const action = resultByTitle(outcome, 'hangs past the action timeout').attempts[0]!;
    expect(action.error?.code).toBe('ACTION_FAILED');
    expect(action.error?.message).toContain('GET /api/hang exceeded its timeout of 1500ms');
    expect(resultByTitle(outcome, 'hangs past its own timeout').attempts[0]!.error?.message).toContain('GET /api/hang exceeded its timeout of 300ms');
    // The headers arrived; the call still waits for the whole body under the same timeout.
    expect(resultByTitle(outcome, 'stalls in the body past its own timeout').attempts[0]!.error?.message).toContain('GET /api/stall-body exceeded its timeout of 300ms');
    const deadline = resultByTitle(outcome, 'hangs past the test timeout').attempts[0]!;
    expect(deadline.error?.code).toBe('TEST_TIMEOUT');
    expect(log.lines()).toEqual(['afterEach:200']);
    // The connection is dropped, not left open past the test.
    await vi.waitFor(() => expect(api.closed.toSorted()).toEqual(['action', 'body', 'deadline', 'own']));
  });

  it('takes an absolute URL on a target with no engine, and names the missing app URL for a path', async () => {
    const file = `import { test, expect } from 'e2e';

test('absolute', async ({ request }) => {
  expect((await request.get('${api.url}/api/ok?x=1')).status).toBe(200);
});

test('a malformed absolute URL', async ({ request }) => {
  await request.get('http://[invalid');
});

test('relative', async ({ request }) => {
  await request.get('/api/ok?token=query-placeholder-6021');
});

test('another scheme', async ({ request }) => {
  await request.get('file:///etc/hosts');
});

test('a blank page', async ({ request }) => {
  await request.get('about:blank');
});
`;
    const { outcome } = await runProject({ 'tests/api.e2e.ts': file }, { config: { targets: [{ name: 'api', platform: 'api' }] } });
    const absolute = resultByTitle(outcome, 'absolute');
    expect(absolute.status, JSON.stringify(absolute.attempts[0]?.error)).toBe('passed');
    expect(absolute.attempts[0]!.steps.map((step) => step.label)).toEqual([`GET ${api.url}/api/ok`]);
    expect(resultByTitle(outcome, 'relative').attempts[0]!.error).toMatchObject({
      code: 'APP_URL_REQUIRED',
      message: expect.stringContaining('request: a path needs an app URL'),
    });
    expect(JSON.stringify(outcome.report)).not.toContain('query-placeholder-6021');
    expect(resultByTitle(outcome, 'another scheme').attempts[0]!.error?.code).toBe('POLICY_DENIED');
    expect(resultByTitle(outcome, 'a malformed absolute URL').attempts[0]!.error).toMatchObject({ code: 'POLICY_DENIED', message: 'request: malformed URL' });
    expect(resultByTitle(outcome, 'a blank page').attempts[0]!.error).toMatchObject({ code: 'POLICY_DENIED', message: 'request: a URL must be a path or an absolute http(s) URL' });
  });

  it('refuses a malformed call before sending it, and names a network failure', async () => {
    const closed = await freePort();
    // Not a configured secret: nothing redacts it, so only the fixture keeps it out.
    const PLACEHOLDER = 'unregistered-placeholder-5150';
    const file = `import { secrets, test } from 'e2e';

test('a GET with a body', async ({ request }) => {
  await request.get('/api/ok', { json: { a: 1 } });
});

test('json and body', async ({ request }) => {
  await request.post('/api/orders', { json: { a: 1 }, body: 'x' });
});

test('a method with a space', async ({ request }) => {
  await request.fetch('/api/ok', { method: 'GET X' });
});

test('a refused connection', async ({ request }) => {
  await request.get('http://127.0.0.1:${closed}/api/ok');
});

test('a refused connection on localhost', async ({ request }) => {
  await request.get('http://localhost:${closed}/api/ok');
});

test('an option request does not take', async ({ request }) => {
  await request.post('/api/refused-options', { data: { sku: 'A1' }, params: { id: '17' } } as never);
});

test('a header fetch sets itself', async ({ request }) => {
  await request.get('/api/refused-options', { headers: { 'Sec-Fetch-Mode': 'navigate' } });
});

test('a header fetch refuses', async ({ request }) => {
  await request.post('/api/refused-options', { body: 'a', headers: { 'Transfer-Encoding': 'chunked' } });
});

test('a malformed connection header', async ({ request }) => {
  await request.get('/api/refused-options', { headers: { connection: 'close,' } });
});

test('headers as a Headers object', async ({ request }) => {
  await request.get('/api/refused-options', { headers: new Headers({ authorization: 'Bearer t' }) as never });
});

test('a refusal is a rejected promise and a failed step', async ({ request }) => {
  const settled = await request.get('/api/ok', { body: 'raw' }).then(() => 'sent', (error: { code?: string }) => error.code);
  if (settled !== 'INVALID_ARGUMENT') throw new Error('settled as ' + settled);
});

test('headers that are not an object', async ({ request }) => {
  await request.get('/api/ok', { headers: 42 as never });
});

test('a header value with a line break', async ({ request }) => {
  await request.get('/api/ok', { headers: { authorization: 'Bearer ${PLACEHOLDER}\\nx: y' } });
});

test('credentials in the URL', async ({ request }) => {
  await request.get('http://user:${PLACEHOLDER}@127.0.0.1:${closed}/api/ok?token=${PLACEHOLDER}');
});

test('TRACE', async ({ request }) => {
  await request.fetch('/api/ok', { method: 'trace' });
});

test('a negative timeout', async ({ request }) => {
  await request.get('/api/ok', { timeout: -1 });
});

test('a timeout no timer holds', async ({ request }) => {
  await request.get('/api/ok', { timeout: 2 ** 31 });
});

test('a control character in a header', async ({ request }) => {
  await request.get('/api/ok', { headers: { 'x-trace': 'a\\u0001b' } });
});

test('a secret in json', async ({ request }) => {
  await request.post('/api/secret-sink', { json: { token: secrets.get('TOKEN') } });
});

test('a bigint in json', async ({ request }) => {
  await request.post('/api/orders', { json: { n: 1n } });
});
`;
    const { outcome } = await runProject({ 'tests/api.e2e.ts': file }, { config: onApi({ secrets: { TOKEN: 'request-sink-secret' } }) });
    const errorOf = (title: string) => resultByTitle(outcome, title).attempts[0]!.error;
    expect(errorOf('a GET with a body')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: a GET request takes no body' });
    expect(errorOf('json and body')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: pass json or body, not both' });
    expect(errorOf('a method with a space')?.code).toBe('INVALID_ARGUMENT');
    expect(errorOf('a refused connection')).toMatchObject({
      code: 'ACTION_FAILED',
      message: expect.stringContaining(`GET http://127.0.0.1:${closed}/api/ok failed: fetch failed: connect ECONNREFUSED`),
    });
    // localhost resolves to two addresses, so Node's refusal is an AggregateError with an empty message.
    expect(errorOf('a refused connection on localhost')?.message).toMatch(new RegExp(`^GET http://localhost:${closed}/api/ok failed: fetch failed: .*ECONNREFUSED`));
    expect(errorOf('an option request does not take')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request.post options has no keys "data", "params"; it takes headers, json, body, timeout' });
    expect(errorOf('headers as a Headers object')?.code).toBe('INVALID_ARGUMENT');
    expect(errorOf('a header fetch sets itself')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: header "Sec-Fetch-Mode" is set by fetch itself; leave it out' });
    expect(errorOf('a header fetch refuses')).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('POST /api/refused-options: fetch refused the request: invalid transfer-encoding header') });
    expect(errorOf('a malformed connection header')).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('fetch refused the request: invalid connection header') });
    expect(api.paths).not.toContain('/api/refused-options');
    const refusal = resultByTitle(outcome, 'a refusal is a rejected promise and a failed step').attempts[0]!;
    expect(refusal.error, JSON.stringify(refusal.error)).toBeUndefined();
    expect(refusal.steps.map(({ api: name, label, status, error }) => ({ api: name, label, status, code: error?.code }))).toEqual([
      { api: 'request.get', label: 'GET /api/ok', status: 'failed', code: 'INVALID_ARGUMENT' },
    ]);
    expect(errorOf('a negative timeout')?.message).toBe('request.get timeout must be a finite number of milliseconds, 0 or more; got -1');
    // A refused URL leaves the label empty, so nothing it holds is shown.
    expect(resultByTitle(outcome, 'credentials in the URL').attempts[0]!.steps.map((step) => step.label)).toEqual(['']);
    expect(errorOf('headers that are not an object')?.code).toBe('INVALID_ARGUMENT');
    expect(errorOf('a header value with a line break')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: header "authorization" has an invalid name or value' });
    expect(errorOf('credentials in the URL')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: a URL must not contain credentials; send them in headers' });
    expect(errorOf('TRACE')?.code).toBe('INVALID_ARGUMENT');
    expect(errorOf('a bigint in json')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: json must be JSON-safe, found bigint' });
    expect(errorOf('a timeout no timer holds')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request.get timeout must be at most 2147483647 milliseconds, got 2147483648' });
    expect(errorOf('a control character in a header')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: header "x-trace" has an invalid name or value' });
    expect(errorOf('a secret in json')).toMatchObject({ code: 'POLICY_DENIED', message: 'request: json must not contain a Secret' });
    expect(api.paths).not.toContain('/api/secret-sink');
    expect(JSON.stringify(outcome.report)).not.toContain(PLACEHOLDER);
  });

  it('is a test fixture, which a beforeAll hook cannot name', async () => {
    const file = `import { test } from 'e2e';

test.beforeAll(async ({ request }) => {
  await request.get('/api/ok');
});

test('runs', async () => {});
`;
    const { outcome } = await runProject({ 'tests/api.e2e.ts': file }, { config: onApi() });
    expect(outcome.report.run.errors).toEqual([expect.objectContaining({ code: 'COLLECTION_ERROR', message: expect.stringContaining('beforeAll hook names "request", a test fixture on target "fake"') })]);
  });

  it('keeps a configured secret out of the step label and the failure', async () => {
    const secret = 'tok-secret-4711';
    const file = `import { test, expect } from 'e2e';

test('leaks nothing', async ({ request }) => {
  expect((await request.get('/api/missing/${secret}')).status).toBe(200);
});
`;
    const { outcome } = await runProject({ 'tests/api.e2e.ts': file }, { config: onApi({ secrets: { TOKEN: secret } }) });
    const attempt = resultByTitle(outcome, 'leaks nothing').attempts[0]!;
    expect(attempt.error?.code).toBe('ASSERTION_FAILED');
    expect(attempt.steps.map((step) => step.label)).toEqual(['GET /api/missing/<secret:TOKEN>']);
    expect(JSON.stringify(outcome.report)).not.toContain(secret);
  });

  it('cuts a step label to what the report admits, and sends the whole URL', async () => {
    const file = `import { test, expect } from 'e2e';

test('a long path', async ({ request }) => {
  const response = await request.get('/files/' + 'x'.repeat(9000));
  expect(response.status).toBe(404);
});
`;
    const { outcome } = await runProject({ 'tests/api.e2e.ts': file }, { config: onApi() });
    assertValidReport(outcome.report);
    const [step] = resultByTitle(outcome, 'a long path').attempts[0]!.steps;
    expect(step!.label).toHaveLength(8192);
    expect(step!.label.endsWith('…')).toBe(true);
    expect(api.paths).toContain('/files/' + 'x'.repeat(9000));
  });

  it('is a name no engine may contribute', () => {
    expect(() => defineEngine({ name: 'shadow', version: '1.0.0', spiVersion: 1, platform: 'shadow', fixtures: { request: () => ({}) } })).toThrow(
      'fixture name "request" shadows a universal fixture',
    );
  });
});
