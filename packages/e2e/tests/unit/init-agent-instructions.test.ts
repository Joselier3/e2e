import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planAgentInstructions, skillPointer } from '../../src/cli/init/agent-instructions.ts';

const BOTH = ['.agents/skills', '.claude/skills'];
const AGENTS_LINE = 'End-to-end tests use e2e; read .agents/skills/e2e/SKILL.md before writing or running one.';
const CLAUDE_LINE = 'End-to-end tests use e2e; read .claude/skills/e2e/SKILL.md before writing or running one.';

const NOTHING = { writes: [], links: [], obstacles: [] };

let dir: string;

/** Puts a skill file where an earlier init, or this run's install, leaves it. */
function installSkill(...locations: string[]): void {
  for (const location of locations) {
    mkdirSync(path.join(dir, location, 'e2e'), { recursive: true });
    writeFileSync(path.join(dir, location, 'e2e', 'SKILL.md'), '# e2e\n');
  }
}

function write(file: string, content: string): void {
  writeFileSync(path.join(dir, file), content);
}

/** Plans for `skillDirs` and applies the writes, as init does after the confirmation. */
function run(skillDirs: readonly string[] = BOTH): ReturnType<typeof planAgentInstructions> {
  const plan = planAgentInstructions(dir, skillDirs, []);
  for (const planned of plan.writes) appendFileSync(planned.absolute, planned.appended);
  return plan;
}

function read(file: string): string {
  return readFileSync(path.join(dir, file), 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-init-instructions-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('planAgentInstructions', () => {
  it('spells the pointer with the skill file of the given directory', () => {
    expect(skillPointer('.agents/skills')).toBe(AGENTS_LINE);
    expect(skillPointer('.claude/skills')).toBe(CLAUDE_LINE);
  });

  it('creates each file with the line for its own skills directory', () => {
    installSkill(...BOTH);
    expect(run().writes.map(({ relative, existing }) => ({ relative, existing }))).toEqual([
      { relative: 'AGENTS.md', existing: false },
      { relative: 'CLAUDE.md', existing: false },
    ]);
    expect(read('AGENTS.md')).toBe(`${AGENTS_LINE}\n`);
    expect(read('CLAUDE.md')).toBe(`${CLAUDE_LINE}\n`);
  });

  it('plans a directory whose skill this run installs, before it is on disk', () => {
    const going = [{ kind: 'link' as const, relative: '.claude/skills/e2e', existing: false, target: '../../.agents/skills/e2e', links: [], obstacles: [] }];
    expect(planAgentInstructions(dir, BOTH, going).writes.map((planned) => planned.relative)).toEqual(['CLAUDE.md']);
  });

  it('writes only the file of a directory that holds the skill', () => {
    installSkill('.claude/skills');
    expect(run(['.claude/skills']).writes.map((planned) => planned.relative)).toEqual(['CLAUDE.md']);
    expect(read('CLAUDE.md')).toBe(`${CLAUDE_LINE}\n`);
  });

  it('writes nothing without a chosen directory, or when the chosen one holds no skill', () => {
    installSkill('.agents/skills');
    expect(run([])).toEqual(NOTHING);
    expect(run(['.claude/skills'])).toEqual(NOTHING);
  });

  it.each([
    ['no trailing newline', '# Project\n\nUse pnpm.', `# Project\n\nUse pnpm.\n\n${AGENTS_LINE}\n`],
    ['a trailing newline', '# Project\n', `# Project\n\n${AGENTS_LINE}\n`],
    ['a trailing blank line', '# Project\n\n', `# Project\n\n${AGENTS_LINE}\n`],
    ['CRLF line endings', '# Project\r\nUse pnpm.\r\n', `# Project\r\nUse pnpm.\r\n\r\n${AGENTS_LINE}\r\n`],
    ['no content', '', `${AGENTS_LINE}\n`],
  ])('appends the line as its own paragraph to a file with %s', (_name, before, after) => {
    installSkill('.agents/skills');
    write('AGENTS.md', before);
    expect(run(['.agents/skills']).writes).toMatchObject([{ relative: 'AGENTS.md', existing: true }]);
    expect(read('AGENTS.md')).toBe(after);
  });

  it('plans nothing on a second run', () => {
    installSkill(...BOTH);
    write('AGENTS.md', '# Project\n');
    run();
    const first = [read('AGENTS.md'), read('CLAUDE.md')];
    expect(run()).toEqual(NOTHING);
    expect([read('AGENTS.md'), read('CLAUDE.md')]).toEqual(first);
  });

  it('leaves a file that names the other installed skill file', () => {
    installSkill(...BOTH);
    write('CLAUDE.md', `# Project\n\nRead .agents/skills/e2e/SKILL.md for tests.\n`);
    expect(run().writes.map((planned) => planned.relative)).toEqual(['AGENTS.md']);
  });

  it('appends to a file that names only a skill file that is not installed', () => {
    installSkill('.claude/skills');
    write('CLAUDE.md', 'Read .agents/skills/e2e/SKILL.md for tests.\n');
    run(['.claude/skills']);
    expect(read('CLAUDE.md')).toBe(`Read .agents/skills/e2e/SKILL.md for tests.\n\n${CLAUDE_LINE}\n`);
  });

  it('writes once through AGENTS.md when CLAUDE.md is a symlink to it', () => {
    installSkill(...BOTH);
    write('AGENTS.md', '# Project\n');
    symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
    expect(run()).toMatchObject({ writes: [{ relative: 'AGENTS.md' }], links: [] });
    expect(read('CLAUDE.md')).toBe(`# Project\n\n${AGENTS_LINE}\n`);
    expect(run()).toEqual(NOTHING);
  });

  it('reports a symlink that leads to a file without the line', () => {
    installSkill('.claude/skills');
    write('AGENTS.md', '# Project\n');
    symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
    const plan = run(['.claude/skills']);
    expect(plan.writes).toEqual([]);
    expect(plan.links).toMatchObject([{ relative: 'CLAUDE.md' }]);
    expect(plan.links[0]?.target.endsWith(`${path.sep}AGENTS.md`)).toBe(true);
    expect(read('AGENTS.md')).toBe('# Project\n');
  });

  it.each(['@AGENTS.md\n', '# Claude\n\n@./AGENTS.md\r\n\r\nUse pnpm.\r\n'])('leaves a CLAUDE.md that imports AGENTS.md: %j', (content) => {
    installSkill(...BOTH);
    write('CLAUDE.md', content);
    expect(run().writes.map((planned) => planned.relative)).toEqual(['AGENTS.md']);
    expect(read('CLAUDE.md')).toBe(content);
  });

  it('appends to a CLAUDE.md whose import is not a file with the line', () => {
    installSkill('.claude/skills');
    write('AGENTS.md', '# Project\n');
    write('CLAUDE.md', '@AGENTS.md\n');
    run(['.claude/skills']);
    expect(read('CLAUDE.md')).toBe(`@AGENTS.md\n\n${CLAUDE_LINE}\n`);
    expect(read('AGENTS.md')).toBe('# Project\n');
  });

  it('stays quiet about a symlink whose target already names the skill', () => {
    installSkill('.agents/skills');
    write('shared.md', `# Shared\n\n${AGENTS_LINE}\n`);
    symlinkSync('shared.md', path.join(dir, 'AGENTS.md'));
    expect(run(['.agents/skills'])).toEqual(NOTHING);
  });

  it('writes once through CLAUDE.md when AGENTS.md is a symlink to it', () => {
    installSkill(...BOTH);
    write('CLAUDE.md', '# Project\n');
    symlinkSync('CLAUDE.md', path.join(dir, 'AGENTS.md'));
    expect(run()).toMatchObject({ writes: [{ relative: 'CLAUDE.md' }], links: [] });
    expect(read('AGENTS.md')).toBe(`# Project\n\n${CLAUDE_LINE}\n`);
    expect(run()).toEqual(NOTHING);
  });

  it('keeps the bytes of a file that is not UTF-8', () => {
    installSkill('.agents/skills');
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    writeFileSync(path.join(dir, 'AGENTS.md'), latin1);
    run(['.agents/skills']);
    expect(readFileSync(path.join(dir, 'AGENTS.md')).subarray(0, latin1.length)).toEqual(latin1);
    expect(read('AGENTS.md').endsWith(`\n\n${AGENTS_LINE}\n`)).toBe(true);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('names a file it cannot read', () => {
    installSkill('.agents/skills');
    write('AGENTS.md', '# Project\n');
    chmodSync(path.join(dir, 'AGENTS.md'), 0o000);
    expect(run(['.agents/skills'])).toEqual({ writes: [], links: [], obstacles: [{ relative: 'AGENTS.md', reason: 'unreadable' }] });
  });

  it('names a directory where the file goes', () => {
    installSkill('.agents/skills');
    mkdirSync(path.join(dir, 'AGENTS.md'));
    expect(run(['.agents/skills'])).toEqual({ writes: [], links: [], obstacles: [{ relative: 'AGENTS.md', reason: 'not a file' }] });
  });
});
