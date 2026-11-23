/** Which shared libraries a Linux browser build needs that the host's loader cannot resolve. */

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const LDD_TIMEOUT_MS = 5_000;
const LISTED_LIBRARIES = 5;

/** Injected seams for tests; a run uses this process's platform and the host's `ldd`. */
export interface HostLibraryProbe {
  readonly platform?: NodeJS.Platform;
  /** Resolves to `ldd <file>`'s stdout, or undefined when `ldd` is absent or cannot read the file. */
  readonly ldd?: (file: string, env: NodeJS.ProcessEnv) => Promise<string | undefined>;
}

function runLdd(file: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('ldd', [file], { env, timeout: LDD_TIMEOUT_MS }, (error, stdout) => resolve(error === null ? stdout : undefined));
  });
}

/** The library names an `ldd` listing marks `not found`. */
export function unresolvedLibraries(lddOutput: string): string[] {
  return lddOutput
    .split('\n')
    .map((line) => /^\s*(\S+) => not found\s*$/.exec(line)?.[1])
    .filter((name) => name !== undefined);
}

/**
 * The shared libraries `executable` and the libraries shipped beside it link
 * against that the loader cannot resolve, in the order `ldd` reports them.
 * Empty off Linux, and when `ldd` is absent or the executable is a wrapper
 * script (webkit), where nothing can be told.
 */
export async function missingHostLibraries(executable: string, env: NodeJS.ProcessEnv, probe: HostLibraryProbe = {}): Promise<string[]> {
  if ((probe.platform ?? process.platform) !== 'linux') return [];
  const directory = path.dirname(executable);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const bundled = entries.filter((entry) => entry.isFile() && /\.so(\.|$)/.test(entry.name)).map((entry) => path.join(directory, entry.name));
  // A bundled library links against its siblings, which the browser loads from its own directory.
  const searchPath = [env['LD_LIBRARY_PATH'], directory].filter((part) => part !== undefined && part !== '').join(':');
  const ldd = probe.ldd ?? runLdd;
  const listings = await Promise.all([...new Set([executable, ...bundled])].map((file) => ldd(file, { ...env, LD_LIBRARY_PATH: searchPath })));
  return [...new Set(listings.flatMap((listing) => (listing === undefined ? [] : unresolvedLibraries(listing))))];
}

/** Why `name` cannot launch with `missing` unresolved, naming the first few and the install that adds them. */
export function missingLibrariesMessage(name: string, missing: readonly string[]): string {
  const listed = missing.slice(0, LISTED_LIBRARIES).join(', ');
  const rest = missing.length > LISTED_LIBRARIES ? ` and ${String(missing.length - LISTED_LIBRARIES)} more` : '';
  const count = missing.length === 1 ? 'a system library is' : `${String(missing.length)} system libraries are`;
  return `${name} cannot launch: ${count} missing (${listed}${rest}); run "npx @e2e-dev/web install ${name} --with-deps" (pnpm: "pnpm exec e2e-web install ${name} --with-deps")`;
}
