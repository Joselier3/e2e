/** The packages an existing config imports, for a re-run of `e2e init` to add the ones package.json lacks. */

import { oxc } from '../../config/typescript.ts';
import { getEnginePresets } from './engines.ts';
import { AI_DEPENDENCIES, GATEWAYS } from './gateways.ts';
import { siblingDependency } from './versions.ts';

/** A string literal with no escapes or interpolation, as a dynamic `import()` argument. */
const PLAIN_STRING = /^(['"`])([^'"`\\$]+)\1$/u;

/** A bare specifier's package name: one segment, or two under a scope. */
const PACKAGE_NAME = /^(@[^/]+\/[^/]+|[^@./][^/]*)(?:\/|$)/u;

/**
 * Every module specifier `source` imports, re-exports from, or loads with a
 * literal `import()`, read from the parsed module so an import in a comment
 * or a string counts for nothing. Throws `TYPESCRIPT_COMPILER_UNAVAILABLE`
 * when oxc cannot load.
 */
function importedSpecifiers(file: string, source: string): string[] {
  const { staticImports, staticExports, dynamicImports } = oxc().parser.parseSync(file, source).module;
  return [
    ...staticImports.map((entry) => entry.moduleRequest.value),
    ...staticExports.flatMap((statement) => statement.entries.map((entry) => entry.moduleRequest?.value)),
    ...dynamicImports.map(({ moduleRequest }) => PLAIN_STRING.exec(source.slice(moduleRequest.start, moduleRequest.end))?.[2]),
  ].filter((specifier) => specifier !== undefined);
}

/**
 * The dependencies of the config in `file` that init has a range for, from
 * its import specifiers: the engines with `@e2e-dev/core`, `ai` with `zod`,
 * and each gateway's provider packages. A gateway counts when the config
 * imports the module its preset imports, such as `e2e/oauth/chatgpt`, and
 * brings the provider packages that module loads. Any other package the
 * config imports is the project's own to declare.
 */
export function configDependencies(file: string, source: string): Readonly<Record<string, string>> {
  const specifiers = new Set(importedSpecifiers(file, source));
  const packages = new Set([...specifiers].flatMap((specifier) => PACKAGE_NAME.exec(specifier)?.[1] ?? []));
  const engines: Readonly<Record<string, string>> = Object.assign({}, ...getEnginePresets().map((preset) => preset.dependencies));
  const core = siblingDependency('@e2e-dev/core');
  const providers: Readonly<Record<string, string>> = Object.assign({}, ...GATEWAYS.map((gateway) => gateway.dependencies));
  const versions: Readonly<Record<string, string>> = { ...engines, ...core, ...providers, ...AI_DEPENDENCIES };

  const needed: Record<string, string> = {};
  for (const name of packages) {
    const range = versions[name];
    if (range !== undefined) needed[name] = range;
  }
  // Every engine peers on `@e2e-dev/core`, as in a new scaffold.
  if (Object.keys(engines).some((name) => packages.has(name))) Object.assign(needed, core);
  const gateways = GATEWAYS.filter((gateway) => specifiers.has(/from '([^']+)'/u.exec(gateway.import)?.[1] ?? ''));
  for (const gateway of gateways) Object.assign(needed, gateway.dependencies);
  // A provider peers on `ai`, and both on zod. zod alone is the project's own schema library.
  if (gateways.length > 0 || packages.has('ai') || Object.keys(providers).some((name) => packages.has(name))) {
    Object.assign(needed, AI_DEPENDENCIES);
  }
  return needed;
}
