/** Parallel scopes: which tests of one file may run at the same time on separate workers. */

import { describeValue } from '@e2e-dev/core/lib/config/validate';
import { CollectionError } from '@e2e-dev/core/lib/internal/errors';
import type { GroupNode, ModuleRegistration } from './registry.ts';

/**
 * Checks a `parallel` value about to be set on a scope: the file, or a group
 * whose `serial` is given. `fileParallel` and `around` are the scopes around
 * it: the file's `parallel`, and the groups enclosing it. A parallel scope
 * inside one that runs in order is refused, as the tests of a serial group
 * or a `parallel: false` scope stay on one worker.
 */
export function checkParallel(
  api: string,
  value: unknown,
  serial: boolean,
  fileParallel: boolean | undefined,
  around: readonly GroupNode[],
): asserts value is boolean | undefined {
  if (value === undefined) return;
  if (typeof value !== 'boolean') {
    throw new CollectionError(`${api}: parallel must be true or false, got ${describeValue(value)}`);
  }
  if (serial) {
    throw new CollectionError(`${api}: parallel cannot be set on a serial group, which runs as one unit on one worker`);
  }
  if (!value) return;
  if (around.some((group) => group.serial)) {
    throw new CollectionError(`${api}: parallel: true cannot be set inside a serial group, which runs as one unit on one worker`);
  }
  if (fileParallel === false || around.some((group) => group.parallel === false)) {
    throw new CollectionError(`${api}: parallel: true cannot be set inside a scope with parallel: false, which runs in order on one worker`);
  }
}

/** Where a test sits among its file's parallel scopes. */
export interface ParallelPlacement {
  /** Whether a scope around the test, a group or the file, has `parallel: true`. */
  readonly declared: boolean;
  /**
   * The outermost scope around the test that runs in order on one worker, a
   * serial group or a scope with `parallel: false`, named uniquely within
   * the file; undefined when no such scope is around it.
   */
  readonly ordered: string | undefined;
  /** Whether a scope around the test has a `beforeAll` or `afterAll` hook. */
  readonly suiteHooks: boolean;
}

/** The placement of each test of one registration, from the groups around the test, outermost first. */
export function parallelPlacements(registration: ModuleRegistration): (groups: readonly GroupNode[]) => ParallelPlacement {
  const hooked = new Set(
    registration.hooks.filter((hook) => hook.kind === 'beforeAll' || hook.kind === 'afterAll').map((hook) => hook.group),
  );
  const names = new Map<GroupNode, string>();
  const nameOf = (group: GroupNode): string => {
    let name = names.get(group);
    if (name === undefined) {
      name = `group-${names.size}`;
      names.set(group, name);
    }
    return name;
  };
  return (groups) => {
    const ordered = groups.find((group) => group.serial || group.parallel === false);
    return {
      declared: registration.parallel === true || groups.some((group) => group.parallel === true),
      ordered: registration.parallel === false ? 'file' : ordered === undefined ? undefined : nameOf(ordered),
      suiteHooks: hooked.has(undefined) || groups.some((group) => hooked.has(group)),
    };
  };
}
