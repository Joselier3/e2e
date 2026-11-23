/**
 * A `--last-failed` rerun and the runs it selected from, as one report. The
 * rerun's document lists every test the run before it passed as unselected,
 * so on its own it shows only the few tests it ran again; folding the two
 * gives the whole suite: carried results for the tests the rerun left out,
 * the rerun's results for the rest, and a test that failed and then passed
 * reads as flaky with both runs' attempts. The runner writes the fold beside
 * the rerun's report (`report-with-reruns.json`), and hands it to the next
 * rerun's reporters as `FinishedRun.lastRun`.
 */

import type { Report1Document as Report } from './build.ts';
import { summarizeResults } from './summary.ts';

type ReportRun = Report['run'];
type ReportResult = ReportRun['results'][number];
type ReportSerialGroup = ReportRun['serialGroups'][number];

/** Statuses that count as a failure of the run. `--last-failed` also runs an interrupted test again, but that one reached no verdict. */
const FAILED_STATUSES = new Set<ReportResult['status']>(['failed', 'timed-out']);

/**
 * A test per target and agent, whatever its `--repeat-each` run: the identity
 * `--last-failed` selects by, so a rerun without the flag runs once a test any
 * repeat of which failed.
 */
function testKey(result: ReportResult): string {
  return [result.testId, result.targetId, result.agent].join('\u0000');
}

/**
 * The rerun's result with the run before's attempts in front of its own,
 * numbered again from 0: the same test's result there, and the further
 * repeats the rerun has no result of its own for. A pass after a failure
 * there, or after a run that was already flaky, is flaky; an interrupted
 * rerun of a test that failed there keeps that failure.
 */
function foldRerun(current: ReportResult, history: readonly ReportResult[]): ReportResult {
  if (history.length === 0) return current;
  const before = history.toSorted((a, b) => a.repeat - b.repeat);
  const attempts = [...before.flatMap((result) => result.attempts), ...current.attempts].map((attempt, index) => ({ ...attempt, index }));
  const failure = before.findLast((result) => FAILED_STATUSES.has(result.status));
  const wasFlaky = before.some((result) => result.status === 'flaky');
  const status =
    current.status === 'passed' && (failure !== undefined || wasFlaky)
      ? 'flaky'
      : current.status === 'interrupted' && failure !== undefined
        ? failure.status
        : current.status;
  return { ...current, status, attempts };
}

/**
 * A serial group the rerun ran again, with the attempts of the groups before
 * it in front of its own: the same group in the run before, then the groups
 * of further repeats its members fold in. A member's history is read off its
 * group, so the first pass's failure stays visible under a member that
 * passed on the rerun.
 */
function foldGroup(current: ReportSerialGroup, before: readonly ReportSerialGroup[]): ReportSerialGroup {
  if (before.length === 0) return current;
  const attempts = [...before.flatMap((group) => group.attempts), ...current.attempts].map((attempt, index) => ({ ...attempt, index }));
  return { ...current, attempts };
}

/**
 * The usage of two runs as one: their totals added, their per-step maxima
 * the larger of the two, and the results counted again.
 */
function addUsage(a: ReportRun['usage'], b: ReportRun['usage'], discoveredResults: number): ReportRun['usage'] {
  const optional = (x: number | undefined, y: number | undefined): number | undefined => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  const cachedTokens = optional(a.modelCachedTokens, b.modelCachedTokens);
  const cost = optional(a.estimatedCostUsd, b.estimatedCostUsd);
  return {
    discoveredResults,
    maxAgentContextBytes: Math.max(a.maxAgentContextBytes, b.maxAgentContextBytes),
    maxLedgerBytes: Math.max(a.maxLedgerBytes, b.maxLedgerBytes),
    maxObservationBytes: Math.max(a.maxObservationBytes, b.maxObservationBytes),
    artifactBytes: a.artifactBytes + b.artifactBytes,
    downloads: a.downloads + b.downloads,
    events: a.events + b.events,
    modelTokens: a.modelTokens + b.modelTokens,
    maxModelCallsInStep: Math.max(a.maxModelCallsInStep, b.maxModelCallsInStep),
    maxActionStepsInStep: Math.max(a.maxActionStepsInStep, b.maxActionStepsInStep),
    ...(cachedTokens === undefined ? {} : { modelCachedTokens: cachedTokens }),
    ...(cost === undefined ? {} : { estimatedCostUsd: cost }),
  };
}

/**
 * Rows by id, a carried row standing for a test the run left out, except
 * where the run's own row already holds a result: a folded report's row then
 * has every attempt, and its carried row only the last run's.
 */
function rowsById<T extends { readonly id: string; readonly selected?: boolean }>(own: readonly T[], carried: readonly T[]): Map<string, T> {
  const rows = new Map(carried.map((row) => [row.id, row]));
  for (const row of own) if (row.selected !== false || !rows.has(row.id)) rows.set(row.id, row);
  return rows;
}

/** Reads the duration of a pass. Wall time is used for older reports. */
function runDuration(run: ReportRun): number {
  return run.durationMs ?? Date.parse(run.finishedAt) - Date.parse(run.startedAt);
}

/**
 * The rerun folded into the run it selected from. A result the rerun has
 * under the same id is folded with it; a test the rerun left out keeps what
 * the run before said, or what the rerun carries for it when an earlier run
 * left it owed (`run.carried`), and so do the serial groups those results'
 * attempts live on. Results the rerun has no id for at all, the further
 * repeats of a `--repeat-each` first pass a plain rerun ran once, fold into
 * the rerun's first result of that test, or stay as carried rows when the
 * rerun left the test out. A run before of another project leaves the rerun
 * as it is. The outcome is the rerun's unless a carried result failed, as a
 * test another filter kept out of the rerun can have, or the rerun carries
 * a test it owed and never ran, a failure limit's skip among them, or a
 * suite hook failure whose scope it did not run again (`run.carried`). Then
 * the fold fails, since the suite is not known to pass. A carried test the
 * first pass interrupted reached no verdict: it leaves the outcome alone, and
 * the fold does not read as a pass. The first run's start time and shard are
 * kept; the duration and usage are both runs' added up. The rerun takes the
 * run before's filter records and the change they judged, since the rows
 * those filters left out are the run before's too. `lastRun` may itself be a
 * fold, which is how the runner chains reruns: its rows then hold every
 * attempt so far, and they win over the rows the rerun carries. An
 * `e2e explore` run before leaves the rerun as it is.
 */
export function foldLastRun(current: Report, lastRun: Report): Report {
  // An exploration that wrote to the same output is not a pass of the suite.
  if (lastRun.run.project.id !== current.run.project.id || lastRun.run.explore !== undefined) return current;
  const carried = current.run.carried;
  const carriedById = new Map((carried?.results ?? []).map((result) => [result.id, result]));
  const currentIds = new Set(current.run.results.map((result) => result.id));
  // The run before's own carried rows stand for the tests it left out, over their filtered rows.
  const beforeById = rowsById(lastRun.run.results, lastRun.run.carried?.results ?? []);
  const leftovers = new Map<string, ReportResult[]>();
  for (const result of beforeById.values()) {
    if (currentIds.has(result.id)) continue;
    const key = testKey(result);
    leftovers.set(key, [...(leftovers.get(key) ?? []), result]);
  }
  const firstOfKey = new Map<string, string>();
  for (const result of current.run.results.toSorted((a, b) => a.repeat - b.repeat)) {
    if (!firstOfKey.has(testKey(result))) firstOfKey.set(testKey(result), result.id);
  }

  const results: ReportResult[] = [];
  // The groups of further repeats a serial member folds in, by the group its rerun result names.
  const absorbed = new Map<string, Set<string>>();
  for (const result of current.run.results) {
    const previous = beforeById.get(result.id);
    if (!result.selected) {
      // A row the run before holds a result for has every attempt so far; a carried one only the last run's.
      const held = previous !== undefined && previous.selected !== false ? previous : undefined;
      results.push(held ?? carriedById.get(result.id) ?? previous ?? result);
      continue;
    }
    const key = testKey(result);
    const extra = firstOfKey.get(key) === result.id ? (leftovers.get(key) ?? []) : [];
    if (extra.length > 0) leftovers.delete(key);
    if (result.serialGroupId !== undefined) {
      const groups = absorbed.get(result.serialGroupId) ?? new Set<string>();
      for (const repeat of extra) if (repeat.serialGroupId !== undefined && repeat.serialGroupId !== result.serialGroupId) groups.add(repeat.serialGroupId);
      if (groups.size > 0) absorbed.set(result.serialGroupId, groups);
    }
    results.push(foldRerun(result, previous === undefined ? extra : [previous, ...extra]));
  }
  for (const extra of leftovers.values()) results.push(...extra);

  const beforeGroups = rowsById(lastRun.run.serialGroups, lastRun.run.carried?.serialGroups ?? []);
  const currentGroupIds = new Set(current.run.serialGroups.map((group) => group.id));
  const absorbedIds = new Set([...absorbed.values()].flatMap((ids) => [...ids]));
  const carriedGroups = (carried?.serialGroups ?? []).filter((group) => !currentGroupIds.has(group.id) && !beforeGroups.has(group.id));
  const serialGroups = [
    ...[...beforeGroups.values()].filter((group) => !currentGroupIds.has(group.id) && !absorbedIds.has(group.id)),
    ...carriedGroups,
    ...current.run.serialGroups.map((group) =>
      foldGroup(group, [
        ...(beforeGroups.has(group.id) ? [beforeGroups.get(group.id)!] : []),
        ...[...(absorbed.get(group.id) ?? [])].flatMap((id) => (beforeGroups.has(id) ? [beforeGroups.get(id)!] : [])).toSorted((a, b) => a.repeat - b.repeat),
      ]),
    ),
  ];

  const carriedErrors = carried?.errors ?? [];
  const carriedFailure =
    carriedErrors.length > 0 ||
    [...carriedById.values()].some((result) => result.status !== 'interrupted') ||
    results.some((result) => result.selected && FAILED_STATUSES.has(result.status));
  return {
    ...current,
    run: {
      ...current.run,
      status: carriedFailure && current.run.status === 'passed' ? 'failed' : current.run.status,
      exitCode: carriedFailure && current.run.exitCode === 0 ? 1 : current.run.exitCode,
      startedAt: lastRun.run.startedAt,
      durationMs: runDuration(lastRun.run) + runDuration(current.run),
      serialGroups,
      results,
      errors: [...current.run.errors, ...carriedErrors],
      summary: summarizeResults(results, serialGroups),
      usage: addUsage(lastRun.run.usage, current.run.usage, results.length),
      filters: lastRun.run.filters,
      changes: lastRun.run.changes,
      // The run that chose the tests decides the shard, so a plain rerun of a shard keeps it.
      ...(lastRun.run.shard === undefined ? {} : { shard: lastRun.run.shard }),
    },
  };
}
