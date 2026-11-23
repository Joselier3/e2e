import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { missingHostLibraries, missingLibrariesMessage, unresolvedLibraries } from '../../src/host-libraries.ts';

const LISTING = [
  '\tlinux-vdso.so.1 (0x0000ffff9d0f2000)',
  '\tlibdl.so.2 => /lib/aarch64-linux-gnu/libdl.so.2 (0x0000ffff8f6a0000)',
  '\tlibglib-2.0.so.0 => not found',
  '\tlibnss3.so => not found',
  '\t/lib/ld-linux-aarch64.so.1 (0x0000ffff9d0b5000)',
  '',
].join('\n');

describe('unresolvedLibraries', () => {
  it('names only the libraries ldd could not find', () => {
    expect(unresolvedLibraries(LISTING)).toEqual(['libglib-2.0.so.0', 'libnss3.so']);
    expect(unresolvedLibraries('\tnot a dynamic executable\n')).toEqual([]);
  });
});

describe('missingHostLibraries', () => {
  let directory: string;
  let executable: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'e2e-host-libraries-'));
    executable = path.join(directory, 'chrome-headless-shell');
    for (const name of ['chrome-headless-shell', 'libEGL.so', 'libvulkan.so.1', 'icudtl.dat']) writeFileSync(path.join(directory, name), '');
    mkdirSync(path.join(directory, 'locales.so'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('asks ldd about the executable and the libraries beside it, once per missing name', async () => {
    const asked: Array<{ file: string; searchPath: string | undefined }> = [];
    const missing = await missingHostLibraries(executable, { LD_LIBRARY_PATH: '/opt/lib' }, {
      platform: 'linux',
      ldd: async (file, env) => {
        asked.push({ file: path.basename(file), searchPath: env['LD_LIBRARY_PATH'] });
        return path.basename(file) === 'libEGL.so' ? '\tlibnss3.so => not found\n\tlibX11.so.6 => not found\n' : LISTING;
      },
    });
    expect(asked.map((ask) => ask.file).toSorted()).toEqual(['chrome-headless-shell', 'libEGL.so', 'libvulkan.so.1']);
    expect(new Set(asked.map((ask) => ask.searchPath))).toEqual(new Set([`/opt/lib:${directory}`]));
    expect(missing.toSorted()).toEqual(['libX11.so.6', 'libglib-2.0.so.0', 'libnss3.so']);
  });

  it('reports nothing when ldd is absent or cannot read the file', async () => {
    expect(await missingHostLibraries(executable, {}, { platform: 'linux', ldd: async () => undefined })).toEqual([]);
  });

  it('never runs ldd off Linux', async () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const missing = await missingHostLibraries(executable, {}, {
        platform,
        ldd: async () => {
          throw new Error('ldd ran');
        },
      });
      expect(missing).toEqual([]);
    }
  });
});

describe('missingLibrariesMessage', () => {
  it('lists the first five libraries and counts the rest', () => {
    const libraries = ['a.so', 'b.so', 'c.so', 'd.so', 'e.so', 'f.so', 'g.so'];
    expect(missingLibrariesMessage('firefox', libraries)).toBe(
      'firefox cannot launch: 7 system libraries are missing (a.so, b.so, c.so, d.so, e.so and 2 more); run "npx @e2e-dev/web install firefox --with-deps" (pnpm: "pnpm exec e2e-web install firefox --with-deps")',
    );
    expect(missingLibrariesMessage('chromium', ['libnss3.so'])).toBe(
      'chromium cannot launch: a system library is missing (libnss3.so); run "npx @e2e-dev/web install chromium --with-deps" (pnpm: "pnpm exec e2e-web install chromium --with-deps")',
    );
  });
});
