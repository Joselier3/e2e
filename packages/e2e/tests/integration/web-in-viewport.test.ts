/**
 * Covers `toBeInViewport` on the web engine:
 *
 * - A pager page off to the side and a paragraph below the fold are visible
 *   but not in the viewport.
 * - A box half past the bottom edge counts as in view up to `ratio: 0.5`.
 * - The negated form passes on a hidden or absent node.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureApp, type FixtureApp } from '../helpers/fixture-app.ts';
import { resultByTitle, runProject, type FixtureProject, type RunOutcome } from '../helpers/run-project.ts';

const SUITE = `import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

const soon = { timeout: 500 };

test('an off-screen pager page is visible but not in the viewport', async ({ app, screen }) => {
  await app.open('/viewport');
  await expect(screen.getByText('First page')).toBeInViewport({ ratio: 1 });
  await expect(screen.getByText('Second page')).toBeVisible();
  await expect(screen.getByText('Second page')).not.toBeInViewport(soon);
  await screen.getByRole('button', { name: 'Next page' }).tap();
  await expect(screen.getByText('Second page')).toBeInViewport({ ratio: 1 });
  await expect(screen.getByText('First page')).not.toBeInViewport(soon);
});

test('content scrolled out of view is not in the viewport', async ({ app, screen }) => {
  await app.open('/viewport');
  await expect(screen.getByText('Far below')).toBeVisible();
  await expect(screen.getByText('Far below')).not.toBeInViewport(soon);
  await screen.getByText('Far below').scrollIntoView();
  await expect(screen.getByText('Far below')).toBeInViewport();
  await expect(screen.getByRole('heading', { name: 'Viewport' })).not.toBeInViewport(soon);
});

test('a box half in view counts as in the viewport up to ratio 0.5', async ({ app, screen }) => {
  await app.open('/viewport');
  await expect(screen.getByText('Peeking box')).toBeInViewport();
  await expect(screen.getByText('Peeking box')).toBeInViewport({ ratio: 0.5 });
  await expect(screen.getByText('Peeking box')).not.toBeInViewport({ ratio: 0.6, ...soon });
});

test("a box half in view doesn't count as in the viewport at ratio 0.6", async ({ app, screen }) => {
  await app.open('/viewport');
  await expect(screen.getByText('Peeking box')).toBeInViewport({ ratio: 0.6, ...soon });
});

test('the negated form passes on a hidden or absent node', async ({ app, screen }) => {
  await app.open('/viewport');
  await expect(screen.getByText('Hidden note')).not.toBeInViewport(soon);
  await expect(screen.getByText('Never rendered')).not.toBeInViewport(soon);
});
`;

describe('toBeInViewport on the web engine', () => {
  let app: FixtureApp;
  let outcome: RunOutcome;
  let project: FixtureProject;

  beforeAll(async () => {
    app = await startFixtureApp();
    ({ outcome, project } = await runProject({ 'tests/viewport.e2e.ts': SUITE }, { appUrl: app.url }));
  }, 120_000);

  afterAll(async () => {
    project?.cleanup();
    await app?.close();
  });

  it.each([
    'an off-screen pager page is visible but not in the viewport',
    'content scrolled out of view is not in the viewport',
    'a box half in view counts as in the viewport up to ratio 0.5',
    'the negated form passes on a hidden or absent node',
  ])('%s', (title) => {
    const result = resultByTitle(outcome, title);
    expect(result.status, JSON.stringify(result.attempts[0]?.error)).toBe('passed');
  });

  it('fails with the observed ratio when less of the box is in view than asked', () => {
    const result = resultByTitle(outcome, "a box half in view doesn't count as in the viewport at ratio 0.6");
    expect(result.status).toBe('failed');
    expect(result.attempts[0]?.error).toMatchObject({
      code: 'ASSERTION_FAILED',
      message: expect.stringContaining('expected: in viewport with ratio 0.6\nobserved: viewport ratio 0.5 (match count 1)'),
    });
  });
});
