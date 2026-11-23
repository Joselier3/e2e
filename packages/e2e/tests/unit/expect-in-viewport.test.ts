import { describe, expect, it } from 'vitest';
import type { SemanticNode } from '@e2e-dev/core/lib/engine/surface';
import { expect as expectFixture } from '../../src/expect/index.ts';
import type { AsyncExpectation } from '@e2e-dev/core/lib/types';
import { createScreenFixture } from '../helpers/screen-fixture.ts';
import { useFakeTime } from '../helpers/fake-time.ts';

useFakeTime();

/** Returns a 100 by 100 pixel box at `x`, `y`, in the fixture's 1280 by 720 viewport. */
function box(testId: string, x: number, y: number, states?: NonNullable<SemanticNode['states']>): SemanticNode {
  return {
    ref: { id: testId, revision: '' },
    role: 'generic',
    testId,
    rect: { x, y, width: 100, height: 100 },
    ...(states === undefined ? {} : { states }),
  };
}

const screen = createScreenFixture([
  box('inside', 100, 100),
  box('half-right', 1230, 100),
  box('quarter-corner', -50, 670),
  box('below', 100, 800),
  box('on-edge', 1280, 100),
  box('hidden', 100, 100, { hidden: true }),
  { ref: { id: 'boxless', revision: '' }, role: 'generic', testId: 'boxless' },
]);
const at = (testId: string): AsyncExpectation => expectFixture(screen.getByTestId(testId));
const soon = { timeout: 100 };

/** Passes options through without type checks, the way a JavaScript test calls the matcher. */
const computed = (options: Record<string, unknown>): { ratio?: number } => ({ ...options });

describe('toBeInViewport', () => {
  it('passes for a box fully in view, at every ratio', async () => {
    await at('inside').toBeInViewport();
    await at('inside').toBeInViewport({ ratio: 0.5 });
    await at('inside').toBeInViewport({ ratio: 1 });
  });

  it('passes for a box partly in view up to the share inside, and fails above it', async () => {
    await at('half-right').toBeInViewport();
    await at('half-right').toBeInViewport({ ratio: 0.5 });
    await at('half-right').not.toBeInViewport({ ratio: 0.51, ...soon });
    await expect(at('half-right').toBeInViewport({ ratio: 0.6, ...soon })).rejects.toMatchObject({
      code: 'ASSERTION_FAILED',
      message: expect.stringContaining('expected: in viewport with ratio 0.6\nobserved: viewport ratio 0.5 (match count 1)'),
    });
    await at('quarter-corner').toBeInViewport({ ratio: 0.25 });
    await at('quarter-corner').not.toBeInViewport({ ratio: 0.3, ...soon });
  });

  it('fails for a box outside the viewport or only touching its edge', async () => {
    await expect(at('below').toBeInViewport(soon)).rejects.toMatchObject({
      code: 'ASSERTION_FAILED',
      message: expect.stringContaining('expected: in viewport\nobserved: viewport ratio 0 (match count 1)'),
    });
    await at('below').not.toBeInViewport(soon);
    await at('on-edge').not.toBeInViewport(soon);
  });

  it('passes negated for a hidden or absent node, and fails with the reason when not negated', async () => {
    await at('hidden').not.toBeInViewport(soon);
    await at('missing').not.toBeInViewport(soon);
    await expect(at('hidden').toBeInViewport(soon)).rejects.toMatchObject({
      message: expect.stringContaining('observed: hidden (match count 1)'),
    });
    await expect(at('missing').toBeInViewport(soon)).rejects.toMatchObject({
      message: expect.stringContaining('observed: no node (match count 0)'),
    });
  });

  it('fails a negated check on a box inside the viewport', async () => {
    await expect(at('inside').not.toBeInViewport(soon)).rejects.toMatchObject({
      code: 'ASSERTION_FAILED',
      message: expect.stringContaining('expected: not in viewport\nobserved: viewport ratio 1'),
    });
  });

  it("counts a shown node that doesn't have a box as outside the viewport", async () => {
    await at('boxless').not.toBeInViewport(soon);
    await expect(at('boxless').toBeInViewport(soon)).rejects.toMatchObject({
      message: expect.stringContaining('observed: no box (match count 1)'),
    });
  });

  it('passes ratio 1 for a box fully inside whose share comes out just under 1', async () => {
    const fractional: SemanticNode = {
      ref: { id: 'fractional', revision: '' },
      role: 'generic',
      testId: 'fractional',
      rect: { x: 20.2, y: 0, width: 5.1, height: 10 },
    };
    await expectFixture(createScreenFixture([fractional]).getByTestId('fractional')).toBeInViewport({ ratio: 1 });
  });

  it.each([1.5, -0.1, Number.NaN, '0.5', null])('refuses ratio %s before reading', (ratio) => {
    expect(() => at('inside').toBeInViewport(computed({ ratio }))).toThrow(
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        message: 'expect.toBeInViewport option ratio must be a number from 0 to 1',
      }),
    );
  });

  it("refuses an option it doesn't take", () => {
    expect(() => at('inside').toBeInViewport(computed({ visible: true }))).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});
