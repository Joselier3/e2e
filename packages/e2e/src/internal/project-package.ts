/** What a project says about a package: the spec its package.json declares and the copy under node_modules. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isPlainObject } from '@e2e-dev/core/lib/internal/options';
import { readPackageManifest } from './package-manager.ts';

/** The package.json sections an install reads a dependency from. */
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** The spec `manifest` declares for `name`, from the first section that lists it, or undefined. */
function declaredSpec(manifest: Record<string, unknown>, name: string): string | undefined {
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = manifest[section];
    const spec = isPlainObject(dependencies) ? dependencies[name] : undefined;
    if (typeof spec === 'string') return spec;
  }
  return undefined;
}

/** The nearest package.json from `cwd` up that declares `name`, with the spec it gives. */
export function declaringPackage(cwd: string, name: string): { dir: string; spec: string } | undefined {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const manifest = readPackageManifest(dir);
    const spec = manifest === undefined ? undefined : declaredSpec(manifest, name);
    if (spec !== undefined) return { dir, spec };
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The nearest `node_modules/<name>` from `dir` up whose package.json names a version, or undefined (not installed, or Plug'n'Play). */
export function installedPackage(dir: string, name: string): { dir: string; version: string } | undefined {
  for (let current = dir; ; current = path.dirname(current)) {
    const packageDir = path.join(current, 'node_modules', name);
    try {
      const manifest: unknown = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
      const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest ? manifest.version : undefined;
      if (typeof version === 'string') return { dir: packageDir, version };
    } catch {
      // Not here; a workspace hoists to a parent.
    }
    if (path.dirname(current) === current) return undefined;
  }
}
