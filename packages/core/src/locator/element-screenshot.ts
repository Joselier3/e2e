/** `locator.screenshot()`: the engine's screenshot of the screen, cut to one match's box. */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LocatorExpression, SemanticNode } from '../engine/surface.ts';
import { asEngineError, TestError } from '../internal/errors.ts';
import { clipBox, cropImage, decodePng, encodePng } from '../internal/image.ts';
import { pollReads, type ReadWindow } from '../internal/time.ts';
import { isNodeVisible, locatorDetails, translateLocatorError, type LocatorEngine } from './engine.ts';
import { describeExpression } from './expression.ts';

type Box = NonNullable<SemanticNode['rect']>;

/**
 * Captures exactly one match and returns the file's path under
 * `artifactsDir`. The match is scrolled into view when the engine can, then
 * the engine's screenshot of the screen is cut to the match's box, at the
 * screenshot's own pixel density. The box is read before and after the
 * capture, and a capture the match moved during is thrown away and taken
 * again, so the file never shows the wrong part of the screen. A match
 * larger than the viewport keeps the part inside it. No capture is taken of
 * a match with nothing inside the viewport, and none outlives a round that
 * did not keep it.
 */
export async function captureMatch(
  engine: LocatorEngine,
  artifactsDir: string,
  expression: LocatorExpression,
  label: string | undefined,
): Promise<string> {
  const deadline = engine.deadline();
  if (engine.session.actions.has('scrollIntoView')) {
    await engine.performUntil(expression, { kind: 'scrollIntoView' }, deadline);
  }
  const shown = describeExpression(expression);
  let kept: string | undefined;
  let missing = `locator did not become visible with a box to capture: ${shown}`;
  const boxOf = async (reads: ReadWindow): Promise<Box | undefined> => {
    const { node } = await engine.tryRead(expression, reads);
    return isNodeVisible(node) ? node.rect : undefined;
  };
  await pollReads({
    deadline,
    signal: engine.signal,
    negated: false,
    reads: engine.reads(deadline),
    evaluate: async (reads) => {
      // A round started at the deadline could not finish: skip it so the wait ends with the reason it has.
      if (deadline.expired()) return false;
      let file: string | undefined;
      try {
        const before = await boxOf(reads);
        if (before === undefined) return false;
        const { viewport } = await reads.read((timeoutMs) => engine.session.observe(engine.readOperation(timeoutMs)));
        if (!overlaps(before, viewport)) {
          missing = `locator is outside the viewport, so it has no pixels to capture: ${shown}`;
          return false;
        }
        if (deadline.expired()) return false;
        file = path.join(artifactsDir, await engine.session.artifacts.screenshot(label, engine.operationWithin(deadline)));
        const after = await boxOf(reads);
        if (after === undefined || !sameBox(before, after)) {
          missing = `locator kept moving while its screenshot was taken: ${shown}`;
          return false;
        }
        const image = decodePng(readFileSync(file));
        // One scale for both axes, from the width, as the engines place their own masks.
        const scale = image.width / viewport.width;
        const box = clipBox(image, { x: after.x * scale, y: after.y * scale, width: after.width * scale, height: after.height * scale });
        if (box === undefined) {
          missing = `locator is outside the screenshot the engine took, so it has no pixels to capture: ${shown}`;
          return false;
        }
        writeFileSync(file, encodePng(cropImage(image, box)));
        kept = path.relative(artifactsDir, file);
        return true;
      } catch (cause) {
        // A document replaced mid-round is read again on the next one, as a stale node is.
        if (asEngineError(cause)?.retryable === true && !deadline.expired()) return false;
        throw translateLocatorError(cause, expression);
      } finally {
        if (file !== undefined && kept === undefined) rmSync(file, { force: true });
      }
    },
    onTimeout: (cause) =>
      new TestError('LOCATOR_NOT_FOUND', missing, {
        details: locatorDetails(expression, deadline.elapsed()),
        ...(cause === undefined ? {} : { cause }),
      }),
  });
  // pollReads returns only once `evaluate` answered true, which set `kept`.
  return kept!;
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Whether any of `box` lies inside a viewport of `size`. */
function overlaps(box: Box, size: { readonly width: number; readonly height: number }): boolean {
  return box.x < size.width && box.y < size.height && box.x + box.width > 0 && box.y + box.height > 0;
}
