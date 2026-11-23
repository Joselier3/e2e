/**
 * The `e2e init` step that points coding agents at the installed skill from
 * the project's instructions files, so a later prompt such as "add a test for
 * checkout" reaches e2e without naming it.
 */

import { existsSync, lstatSync, readFileSync, type Stats } from 'node:fs';
import path from 'node:path';
import { realpathOfExisting } from '@e2e-dev/core/lib/internal/paths';
import { SKILL_NAME } from '../skill.ts';
import type { SkillInstall } from './agent-skill.ts';

/** The instructions file each skills directory's agents read: `AGENTS.md` for most, `CLAUDE.md` for Claude Code. */
const INSTRUCTIONS_FILES: readonly { readonly file: string; readonly skillDir: string }[] = [
  { file: 'AGENTS.md', skillDir: '.agents/skills' },
  { file: 'CLAUDE.md', skillDir: '.claude/skills' },
];

interface InstructionsWrite {
  /** Project-relative file, e.g. `AGENTS.md`. */
  readonly relative: string;
  /** True when the file already existed, so the write appends to it. */
  readonly existing: boolean;
  readonly absolute: string;
  readonly content: string;
}

/** An instructions file that is a symlink init will not write through. */
interface InstructionsLink {
  readonly relative: string;
  /** Absolute path the link leads to; the path as written when it dangles. */
  readonly target: string;
}

/** What init plans for the instructions files: the writes, and the links it leaves alone. */
interface InstructionsPlan {
  readonly writes: readonly InstructionsWrite[];
  readonly links: readonly InstructionsLink[];
}

/** The line an instructions file gets for the skill in `skillDir`. */
export function skillPointer(skillDir: string): string {
  return `End-to-end tests use e2e; read ${skillFile(skillDir)} before writing or running one.`;
}

/**
 * Plans the pointer line for the instructions file of each chosen skills
 * directory that holds the skill once `going` is written. A missing file is
 * created with the line; an existing one gets it appended, the rest of its
 * content byte-for-byte as it was. A file needs nothing when it already names
 * a skill file this run leaves in place, or when it hands over to another
 * instructions file that has the line: a symlink to it, or a Claude Code
 * `@AGENTS.md` import. Any other symlink is returned among `links` for the
 * caller to report and skip.
 */
export function planAgentInstructions(cwd: string, skillDirs: readonly string[], going: readonly SkillInstall[]): InstructionsPlan {
  const held = skillDirs.filter((dir) =>
    going.some((install) => install.relative === `${dir}/${SKILL_NAME}`) || existsSync(path.join(cwd, skillFile(dir))),
  );
  const mentions = held.map(skillFile);
  const writes: InstructionsWrite[] = [];
  const links: InstructionsLink[] = [];
  /** Real paths of the files that carry a pointer after this run. */
  const pointed = new Set<string>();
  for (const { file, skillDir } of INSTRUCTIONS_FILES) {
    if (!held.includes(skillDir)) continue;
    const absolute = path.join(cwd, file);
    const entry = lstatOrUndefined(absolute);
    if (entry?.isSymbolicLink()) {
      const target = realpathOfExisting(absolute);
      if (!pointed.has(target)) links.push({ relative: file, target });
      continue;
    }
    if (entry !== undefined && !entry.isFile()) continue;
    const current = entry === undefined ? undefined : readFileSync(absolute, 'utf8');
    if (current !== undefined && mentions.some((mention) => current.includes(mention))) {
      pointed.add(realpathOfExisting(absolute));
      continue;
    }
    if (current !== undefined && importedFiles(cwd, current).some((imported) => pointed.has(imported))) continue;
    writes.push({ relative: file, existing: current !== undefined, absolute, content: appendLine(current ?? '', skillPointer(skillDir)) });
    pointed.add(realpathOfExisting(absolute));
  }
  return { writes, links };
}

function skillFile(skillDir: string): string {
  return `${skillDir}/${SKILL_NAME}/SKILL.md`;
}

/** Real paths of the files `content` pulls in with a Claude Code import, a line that is only `@path`. */
function importedFiles(cwd: string, content: string): string[] {
  return [...content.matchAll(/^@(\S+)[ \t]*\r?$/gmu)].map((match) => realpathOfExisting(path.resolve(cwd, match[1] ?? '')));
}

/** `content` with `line` as its own last paragraph, in the file's line endings; nothing before it changes. */
function appendLine(content: string, line: string): string {
  if (content === '') return `${line}\n`;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const gap = /\n\r?\n$/u.test(content) ? '' : content.endsWith('\n') ? eol : `${eol}${eol}`;
  return `${content}${gap}${line}${eol}`;
}

/** The entry at `target` without following a final symlink; undefined when missing or unreachable. */
function lstatOrUndefined(target: string): Stats | undefined {
  try {
    return lstatSync(target);
  } catch {
    return undefined;
  }
}
