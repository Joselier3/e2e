import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guide } from '../../src/cli/guide.ts';
import { readGuide } from '../../src/cli/skill.ts';

const RUNNING = '0.24.0';
let dir: string;
let stdout: string;
let stderr: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-guide-version-'));
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((stdout += String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function declare(spec: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { e2e: spec }, ...extra }));
}

/** An installed e2e whose guide says which version wrote it; `skill: false` for a release from before the skill shipped. */
function install(version: string, skill = true): void {
  const packageDir = path.join(dir, 'node_modules', 'e2e');
  mkdirSync(path.join(packageDir, 'skills', 'e2e', 'references'), { recursive: true });
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'e2e', version }));
  if (!skill) return;
  writeFileSync(path.join(packageDir, 'skills', 'e2e', 'SKILL.md'), `---\nname: e2e\n---\n\n# overview of ${version}\n`);
  writeFileSync(path.join(packageDir, 'skills', 'e2e', 'references', 'only-here.md'), `# topic of ${version}\n`);
}

function run(topic?: string, cwd = dir): number {
  return guide(topic, { version: RUNNING, cwd, env: {} });
}

describe('e2e guide and the version the project uses', () => {
  it('prints its own guide and names its version outside a project', () => {
    expect(run()).toBe(0);
    expect(stdout).toBe(readGuide(undefined));
    expect(stderr).toBe(`Guide for e2e ${RUNNING}\n`);
  });

  it.each(['0.24.0', '^0.24.0', '>=0.23.0 <1', 'latest', 'workspace:*'])('adds nothing when package.json declares %s', (spec) => {
    declare(spec);
    expect(run('setup')).toBe(0);
    expect(stdout).toBe(readGuide('setup'));
    expect(stderr).toBe(`Guide for e2e ${RUNNING}\n`);
  });

  it('names both versions and the matching commands when the declared version is not installed', () => {
    declare('0.23.0');
    expect(run()).toBe(0);
    expect(stdout).toBe(readGuide(undefined));
    expect(stderr).toBe(
      'Guide for e2e 0.24.0, but package.json declares e2e 0.23.0 and no installed copy was found. For the matching guide, run `npm install` and then `npm exec -- e2e guide`, or run `npx e2e@0.23.0 guide`.\n',
    );
  });

  it('quotes a declared range and uses the project package manager, from a subdirectory too', () => {
    declare('^0.23.0', { packageManager: 'pnpm@10.0.0' });
    mkdirSync(path.join(dir, 'tests'));
    expect(run(undefined, path.join(dir, 'tests'))).toBe(0);
    expect(stderr).toBe(
      `Guide for e2e 0.24.0, but ${path.join('..', 'package.json')} declares e2e ^0.23.0 and no installed copy was found. For the matching guide, run \`pnpm install\` and then \`pnpm exec e2e guide\`, or run \`npx "e2e@^0.23.0" guide\`.\n`,
    );
  });

  it("prints the installed copy's guide and topics when it is another version", () => {
    declare('^0.23.0');
    install('0.23.1');
    expect(run()).toBe(0);
    expect(stdout).toBe('# overview of 0.23.1\n');
    expect(stderr).toBe('Guide for e2e 0.23.1, the version installed in this project (this CLI is e2e 0.24.0)\n');
    stdout = '';
    expect(run('only-here')).toBe(0);
    expect(stdout).toBe('# topic of 0.23.1\n');
    stderr = '';
    expect(run('setup')).toBe(2);
    expect(stderr).toBe('Guide for e2e 0.23.1, the version installed in this project (this CLI is e2e 0.24.0)\nunknown topic "setup"; topics: only-here\n');
  });

  it('says when the installed copy is behind what package.json declares', () => {
    declare('^0.25.0');
    install(RUNNING);
    expect(run()).toBe(0);
    expect(stdout).toBe(readGuide(undefined));
    expect(stderr).toBe(
      'Guide for e2e 0.24.0, but package.json declares e2e ^0.25.0, which the installed e2e 0.24.0 is outside of; run `npm install` for the matching guide\n',
    );
  });

  it('keeps its own guide when package.json declares its version and the installed copy is a stale one', () => {
    declare('^0.24.0');
    install('0.20.0');
    expect(run()).toBe(0);
    expect(stdout).toBe(readGuide(undefined));
    expect(stderr).toBe('Guide for e2e 0.24.0. package.json declares e2e ^0.24.0, which the installed e2e 0.20.0 is outside of; run `npm install`\n');
  });

  it("prints an installed copy's guide in a directory with no package.json", () => {
    install('0.23.1');
    expect(run()).toBe(0);
    expect(stdout).toBe('# overview of 0.23.1\n');
  });

  it('says so when the installed version ships no guide', () => {
    declare('0.10.0');
    install('0.10.0', false);
    expect(run()).toBe(0);
    expect(stdout).toBe(readGuide(undefined));
    expect(stderr).toBe("Guide for e2e 0.24.0; the project's installed e2e 0.10.0 ships no guide\n");
  });
});
