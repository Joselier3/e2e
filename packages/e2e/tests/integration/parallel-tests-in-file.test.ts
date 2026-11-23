import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertValidReport } from '../helpers/report-schema.ts';
import { resultByTitle, runProjectWithConfigFile, workerFakeConfigSource, type RunOptions } from '../helpers/run-project.ts';

/** What one test body or hook wrote down: where it ran, and when. */
interface Mark {
  readonly name: string;
  readonly pid: number;
  readonly start: number;
  readonly end: number;
}

/**
 * Runs one test file on worker processes and returns what its bodies and
 * hooks marked. In the file, `mark(name)` takes `HOLD_MS` and records the
 * process it ran in, so tests on separate workers overlap in time.
 */
async function runFile(body: string, options: { workers: number; config?: string; runOptions?: Partial<RunOptions> }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-parallel-'));
  const source = `import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'e2e';

async function mark(name: string): Promise<void> {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 400));
  writeFileSync(path.join(${JSON.stringify(dir)}, name + '-' + process.pid + '-' + start), JSON.stringify({ name, pid: process.pid, start, end: Date.now() }));
}

${body}
`;
  const { outcome, project } = await runProjectWithConfigFile(
    { 'tests/file.e2e.ts': source },
    { configSource: workerFakeConfigSource(options.workers, options.config ?? ''), ...(options.runOptions === undefined ? {} : { runOptions: options.runOptions }) },
  );
  const marks = readdirSync(dir).map((entry) => JSON.parse(readFileSync(path.join(dir, entry), 'utf8')) as Mark);
  rmSync(dir, { recursive: true, force: true });
  project.cleanup();
  const named = (name: string): Mark[] => marks.filter((mark) => mark.name === name);
  const one = (name: string): Mark => {
    const [found, ...rest] = named(name);
    if (found === undefined || rest.length > 0) throw new Error(`expected one mark named ${name}, got ${named(name).length}`);
    return found;
  };
  return { outcome, marks, named, one };
}

function overlap(a: Mark, b: Mark): boolean {
  return a.start < b.end && b.start < a.end;
}

const FOUR_TESTS = [1, 2, 3, 4].map((n) => `test('t${n}', async () => { await mark('t${n}'); });`).join('\n');

describe('parallel tests within one file', () => {
  it(
    'runs a file in order on one worker by default',
    async () => {
      const { outcome, marks, one } = await runFile(FOUR_TESTS, { workers: 4 });
      expect(outcome.exitCode).toBe(0);
      expect(new Set(marks.map((mark) => mark.pid)).size).toBe(1);
      expect(one('t1').end).toBeLessThanOrEqual(one('t2').start);
      expect(one('t3').end).toBeLessThanOrEqual(one('t4').start);
    },
    120_000,
  );

  it(
    'runs the tests of a parallel describe at the same time on separate workers, and reports them in declaration order',
    async () => {
      const { outcome, marks, one } = await runFile(`test.describe('group', { parallel: true }, () => {\n${FOUR_TESTS}\n});`, { workers: 4 });
      expect(outcome.exitCode).toBe(0);
      expect(new Set(marks.map((mark) => mark.pid)).size).toBe(4);
      expect(overlap(one('t1'), one('t4'))).toBe(true);
      expect(outcome.report.run.results.map((result) => result.titlePath.at(-1))).toEqual(['t1', 't2', 't3', 't4']);
      assertValidReport(outcome.report);
    },
    120_000,
  );

  it(
    'runs a whole file in parallel from a top-level describe.configure',
    async () => {
      const { outcome, marks } = await runFile(`test.describe.configure({ parallel: true });\n${FOUR_TESTS}`, { workers: 4 });
      expect(outcome.exitCode).toBe(0);
      expect(new Set(marks.map((mark) => mark.pid)).size).toBe(4);
    },
    120_000,
  );

  it(
    'runs every file in parallel under fullyParallel, in the config or as the flag, except a file with parallel: false',
    async () => {
      const config = await runFile(FOUR_TESTS, { workers: 4, config: '\n  fullyParallel: true,' });
      expect(config.outcome.exitCode).toBe(0);
      expect(new Set(config.marks.map((mark) => mark.pid)).size).toBe(4);

      const flag = await runFile(FOUR_TESTS, { workers: 4, runOptions: { fullyParallel: true } });
      expect(flag.outcome.exitCode).toBe(0);
      expect(new Set(flag.marks.map((mark) => mark.pid)).size).toBe(4);

      const optedOut = await runFile(`test.describe.configure({ parallel: false });\n${FOUR_TESTS}`, { workers: 4, config: '\n  fullyParallel: true,' });
      expect(optedOut.outcome.exitCode).toBe(0);
      expect(new Set(optedOut.marks.map((mark) => mark.pid)).size).toBe(1);
    },
    180_000,
  );

  it(
    'keeps a serial group and a parallel: false group in a parallel file on one worker each, in order',
    async () => {
      const { outcome, one } = await runFile(
        `test.describe.configure({ parallel: true });
test('alone', async () => { await mark('alone'); });
test.describe('steps', { serial: true }, () => {
  test('step 1', async () => { await mark('step 1'); });
  test('step 2', async () => { await mark('step 2'); });
});
test.describe('ordered', { parallel: false }, () => {
  test('first', async () => { await mark('first'); });
  test('second', async () => { await mark('second'); });
});`,
        { workers: 4 },
      );
      expect(outcome.exitCode).toBe(0);
      expect(one('step 1').pid).toBe(one('step 2').pid);
      expect(one('step 1').end).toBeLessThanOrEqual(one('step 2').start);
      expect(one('first').pid).toBe(one('second').pid);
      expect(one('first').end).toBeLessThanOrEqual(one('second').start);
      expect(new Set([one('alone').pid, one('step 1').pid, one('first').pid]).size).toBe(3);
      expect(outcome.report.run.serialGroups).toHaveLength(1);
      expect(outcome.report.run.serialGroups[0]!.status).toBe('passed');
    },
    120_000,
  );

  it(
    'runs beforeAll and afterAll once for each worker that runs tests of the scope, and worker fixtures once per worker',
    async () => {
      const { outcome, marks, named } = await runFile(
        `const withWorker = test.extend<{}, { perWorker: number }>({
  perWorker: [async ({}, use) => { await mark('fixture'); await use(1); }, { scope: 'worker' }],
});
withWorker.describe.configure({ parallel: true });
withWorker.beforeAll(async () => { await mark('beforeAll'); });
withWorker.afterAll(async () => { await mark('afterAll'); });
${[1, 2, 3, 4].map((n) => `withWorker('t${n}', async ({ perWorker }) => { await mark('t${n}'); });`).join('\n')}`,
        { workers: 2 },
      );
      expect(outcome.exitCode).toBe(0);
      const tests = marks.filter((mark) => /^t\d$/.test(mark.name));
      expect(new Set(tests.map((mark) => mark.pid)).size).toBe(2);
      for (const hook of ['beforeAll', 'afterAll', 'fixture']) {
        expect(named(hook)).toHaveLength(2);
        expect(new Set(named(hook).map((mark) => mark.pid)).size).toBe(2);
      }
    },
    120_000,
  );

  it(
    'retries a failing parallel test on its own and leaves the others passed',
    async () => {
      const { outcome } = await runFile(
        `test.describe.configure({ parallel: true });
test('t1', async () => { await mark('t1'); });
test('fails', async () => { await mark('fails'); throw new Error('always'); });
test('t3', async () => { await mark('t3'); });`,
        { workers: 3, config: '\n  retries: 1,' },
      );
      expect(outcome.exitCode).toBe(1);
      expect(resultByTitle(outcome, 't1').status).toBe('passed');
      expect(resultByTitle(outcome, 't3').status).toBe('passed');
      expect(resultByTitle(outcome, 'fails').status).toBe('failed');
      expect(resultByTitle(outcome, 'fails').attempts).toHaveLength(2);
    },
    120_000,
  );

  it(
    'runs a parallel file in order on one worker when the run has one worker',
    async () => {
      const { outcome, marks, one } = await runFile(`test.describe.configure({ parallel: true });\n${FOUR_TESTS}`, { workers: 1 });
      expect(outcome.exitCode).toBe(0);
      expect(new Set(marks.map((mark) => mark.pid)).size).toBe(1);
      expect(one('t1').end).toBeLessThanOrEqual(one('t2').start);
    },
    120_000,
  );
});
