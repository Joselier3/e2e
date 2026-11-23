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
  close(): Promise<void>;
}

async function startApi(): Promise<Api> {
  const closed: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
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
    response.end('nope');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    closed,
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
  it('sends calls against the app URL, records each as a step, and checks them with toBeOK', async () => {
    const file = `import { test, expect } from 'e2e';

test('creates an order', async ({ request }) => {
  const created = await request.post('/api/orders?ref=r1', { json: { sku: 'A1' }, headers: { authorization: 'Bearer t' } });
  expect(created).toBeOK();
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ received: { sku: 'A1' }, contentType: 'application/json', query: '?ref=r1', auth: 'Bearer t' });
  const cookies = await request.get('/api/cookies');
  expect(cookies.headers['set-cookie']).toBe('a=1\\nb=2');
  expect(Object.hasOwn((await request.get('/api/proto')).headers, '__proto__')).toBe(true);
  expect(await cookies.text()).toBe('ok');
  const missing = await request.fetch('/api/missing', { method: 'delete' });
  expect(missing.status).toBe(404);
  expect(missing.ok).toBe(false);
  expect(missing).not.toBeOK();
});

test('fails toBeOK on a 404', async ({ request }) => {
  expect(await request.get('/api/missing')).toBeOK();
});

test('fails not.toBeOK on a 2xx', async ({ request }) => {
  expect(await request.get('/api/ok')).not.toBeOK();
});

test('keeps a soft toBeOK failure', async ({ request }) => {
  expect.soft(await request.get('/api/missing')).toBeOK();
  await request.get('/api/ok');
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
    const notOk = resultByTitle(outcome, 'fails toBeOK on a 404').attempts[0]!.error;
    expect(notOk?.code).toBe('ASSERTION_FAILED');
    expect(notOk?.message).toContain('expected GET /api/missing to be OK (a 2xx status), got 404 Not Found');
    const ok = resultByTitle(outcome, 'fails not.toBeOK on a 2xx').attempts[0]!.error;
    expect(ok?.code).toBe('ASSERTION_FAILED');
    expect(ok?.message).toContain('expected GET /api/ok not to be OK, got 200 OK');
    const soft = resultByTitle(outcome, 'keeps a soft toBeOK failure').attempts[0]!;
    expect(soft.error?.message).toContain('1 soft assertion failed');
    expect(soft.steps.map((step) => step.label)).toEqual(['GET /api/missing', 'GET /api/ok']);
  });

  it('aborts a call at the action timeout, and an afterEach call runs on its own budget after the body timed out', async () => {
    const file = `import { test } from 'e2e';
import { log } from './log.ts';

test('hangs past the action timeout', async ({ request }) => {
  await request.get('/api/hang?who=action');
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
    const deadline = resultByTitle(outcome, 'hangs past the test timeout').attempts[0]!;
    expect(deadline.error?.code).toBe('TEST_TIMEOUT');
    expect(log.lines()).toEqual(['afterEach:200']);
    // The connection is dropped, not left open past the test.
    await vi.waitFor(() => expect(api.closed.toSorted()).toEqual(['action', 'deadline', 'own']));
  });

  it('takes an absolute URL on a target with no engine, and names the missing app URL for a path', async () => {
    const file = `import { test, expect } from 'e2e';

test('absolute', async ({ request }) => {
  expect(await request.get('${api.url}/api/ok?x=1')).toBeOK();
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
    expect(resultByTitle(outcome, 'a blank page').attempts[0]!.error).toMatchObject({ code: 'POLICY_DENIED', message: 'request: forbidden URL scheme: about:' });
  });

  it('refuses a malformed call before sending it, and names a network failure', async () => {
    const closed = await freePort();
    // Not a configured secret: nothing redacts it, so only the fixture keeps it out.
    const PLACEHOLDER = 'unregistered-placeholder-5150';
    const file = `import { test } from 'e2e';

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

test('a bigint in json', async ({ request }) => {
  await request.post('/api/orders', { json: { n: 1n } });
});
`;
    const { outcome } = await runProject({ 'tests/api.e2e.ts': file }, { config: onApi() });
    const errorOf = (title: string) => resultByTitle(outcome, title).attempts[0]!.error;
    expect(errorOf('a GET with a body')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: a GET request takes no body' });
    expect(errorOf('json and body')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: pass json or body, not both' });
    expect(errorOf('a method with a space')?.code).toBe('INVALID_ARGUMENT');
    expect(errorOf('a refused connection')).toMatchObject({
      code: 'ACTION_FAILED',
      message: expect.stringContaining(`GET http://127.0.0.1:${closed}/api/ok failed: connect ECONNREFUSED`),
    });
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
    expect(errorOf('a bigint in json')).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'request: json must be a JSON-serializable value' });
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
  expect(await request.get('/api/missing/${secret}')).toBeOK();
});
`;
    const { outcome } = await runProject({ 'tests/api.e2e.ts': file }, { config: onApi({ secrets: { TOKEN: secret } }) });
    const attempt = resultByTitle(outcome, 'leaks nothing').attempts[0]!;
    expect(attempt.error?.code).toBe('ASSERTION_FAILED');
    expect(attempt.steps).toHaveLength(1);
    expect(JSON.stringify(outcome.report)).not.toContain(secret);
  });

  it('is a name no engine may contribute', () => {
    expect(() => defineEngine({ name: 'shadow', version: '1.0.0', spiVersion: 1, platform: 'shadow', fixtures: { request: () => ({}) } })).toThrow(
      'fixture name "request" shadows a universal fixture',
    );
  });
});
