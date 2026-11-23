/** The packages an existing config imports, for a re-run of `e2e init` to add the ones package.json lacks. */

import { createRequire, isBuiltin } from 'node:module';
import type * as OxcParser from 'oxc-parser';
import { getEnginePresets } from './engines.ts';
import { AI_DEPENDENCIES, GATEWAYS } from './gateways.ts';
import { siblingDependency } from './versions.ts';

const ownRequire = createRequire(import.meta.url);

/** A string literal with no escapes or interpolation, as a dynamic `import()` argument. */
const PLAIN_STRING = /^(['"`])([^'"`\\$]+)\1$/u;

/** A bare specifier's package name: one segment, or two under a scope. Path aliases such as `@/lib` and `~/lib` match nothing. */
const PACKAGE_NAME = /^(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:\/|$)/u;

/**
 * Every module specifier `source` imports, re-exports from, or loads with a
 * literal `import()`, read from the parsed module so a commented-out import
 * counts for nothing. Empty when oxc's native binding is missing, which
 * leaves init working as it did before it read the config.
 */
function importedSpecifiers(file: string, source: string): string[] {
  let parsed: OxcParser.ParseResult;
  try {
    parsed = (ownRequire('oxc-parser') as typeof OxcParser).parseSync(file, source);
  } catch {
    return [];
  }
  const { staticImports, staticExports, dynamicImports } = parsed.module;
  return [
    ...staticImports.map((entry) => entry.moduleRequest.value),
    ...staticExports.flatMap((statement) => statement.entries.map((entry) => entry.moduleRequest?.value)),
    ...dynamicImports.map(({ moduleRequest }) => PLAIN_STRING.exec(source.slice(moduleRequest.start, moduleRequest.end))?.[2]),
  ].filter((specifier) => specifier !== undefined);
}

/** What an existing config needs installed. */
export interface ConfigDependencies {
  /** Packages init has a range for: the engines with `@e2e-dev/core`, `ai` with `zod`, and each gateway's provider packages. */
  readonly known: Readonly<Record<string, string>>;
  /** Other packages the config imports. Init has no version for these and adds none of them. */
  readonly unknown: readonly string[];
}

/**
 * The dependencies of the config in `file`, from its import specifiers. A
 * gateway counts when the config imports the module its preset imports, such
 * as `e2e/oauth/chatgpt`, and brings the provider packages that module loads.
 */
export function configDependencies(file: string, source: string): ConfigDependencies {
  const specifiers = new Set(importedSpecifiers(file, source));
  const packages = new Set([...specifiers].flatMap((specifier) => PACKAGE_NAME.exec(specifier)?.[1] ?? []));
  const engines: Readonly<Record<string, string>> = Object.assign({}, ...getEnginePresets().map((preset) => preset.dependencies));
  const core = siblingDependency('@e2e-dev/core');
  const providers: Readonly<Record<string, string>> = Object.assign({}, ...GATEWAYS.map((gateway) => gateway.dependencies));
  const versions: Readonly<Record<string, string>> = { ...engines, ...core, ...providers, ...AI_DEPENDENCIES };

  const known: Record<string, string> = {};
  const unknown: string[] = [];
  for (const name of packages) {
    const range = versions[name];
    if (range !== undefined) known[name] = range;
    else if (name !== 'e2e' && !isBuiltin(name)) unknown.push(name);
  }
  // Every engine peers on `@e2e-dev/core`, as in a new scaffold.
  if (Object.keys(engines).some((name) => packages.has(name))) Object.assign(known, core);
  const gateways = GATEWAYS.filter((gateway) => specifiers.has(moduleOf(gateway.import)));
  for (const gateway of gateways) Object.assign(known, gateway.dependencies);
  // `ai` and every provider peer on zod, and a provider on `ai`.
  if (gateways.length > 0 || Object.keys({ ...providers, ...AI_DEPENDENCIES }).some((name) => packages.has(name))) {
    Object.assign(known, AI_DEPENDENCIES);
  }
  return { known, unknown };
}

/** The module a preset's one-line import statement names. */
function moduleOf(statement: string): string {
  return importedSpecifiers('preset.ts', statement)[0] ?? '';
}
