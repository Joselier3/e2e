/**
 * The `e2e init` step that points coding agents at the installed skill from
 * the project's instructions files, so a later prompt such as "add a test for
 * checkout" reaches e2e without naming it.
 */

import { existsSync, lstatSync, readFileSync, type Stats } from 'node:fs';
import path from 'node:path';
import { onDiskPath, realpathOfExisting } from '@e2e-dev/core/lib/internal/paths';
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
  /** What goes at the end of the file; nothing before it is rewritten, so its bytes stay as they are. */
  readonly appended: string;
}

/** An instructions file that is a symlink init will not write through. */
interface InstructionsLink {
  readonly relative: string;
  /** Absolute path the link leads to; the path as written when it dangles. */
  readonly target: string;
}

/** An instructions file init cannot read as a file. */
interface InstructionsObstacle {
  readonly relative: string;
  readonly reason: string;
}

/** What init plans for the instructions files: the writes, and the entries it leaves alone. */
interface InstructionsPlan {
  readonly writes: readonly InstructionsWrite[];
  readonly links: readonly InstructionsLink[];
  readonly obstacles: readonly InstructionsObstacle[];
}

/** The line an instructions file gets for the skill in `skillDir`. */
export function skillPointer(skillDir: string): string {
  return `End-to-end tests use e2e; read ${skillFile(skillDir)} before writing or running one.`;
}

/**
 * Plans the pointer line for the instructions file of each chosen skills
 * directory that holds the skill once `going` is written. A missing file is
 * created with the line and an existing one gets it appended. A file needs
 * nothing when it already names a skill file this run leaves in place, or
 * when it hands over to another instructions file that has the line: a
 * symlink to it, or a Claude Code `@AGENTS.md` import. A symlink to a file
 * without the line is returned among `links`, and a directory or an
 * unreadable file among `obstacles`, for the caller to report and skip.
 */
export function planAgentInstructions(cwd: string, skillDirs: readonly string[], going: readonly SkillInstall[]): InstructionsPlan {
  const held = skillDirs.filter((dir) =>
    going.some((install) => install.relative === `${dir}/${SKILL_NAME}`) || existsSync(path.join(cwd, skillFile(dir))),
  );
  const mentions = held.map(skillFile);
  const files = INSTRUCTIONS_FILES.filter(({ skillDir }) => held.includes(skillDir)).map(({ file, skillDir }) => {
    const absolute = path.join(cwd, file);
    return { file, skillDir, absolute, entry: lstatOrUndefined(absolute) };
  });
  const writes: InstructionsWrite[] = [];
  const links: InstructionsLink[] = [];
  const obstacles: InstructionsObstacle[] = [];
  /** On-disk paths of the files that carry a pointer after this run. */
  const pointed = new Set<string>();
  for (const { file, skillDir, absolute, entry } of files) {
    if (entry?.isSymbolicLink()) continue;
    if (entry !== undefined && !entry.isFile()) {
      obstacles.push({ relative: file, reason: 'not a file' });
      continue;
    }
    const current = entry === undefined ? undefined : readOrUndefined(absolute);
    if (entry !== undefined && current === undefined) {
      obstacles.push({ relative: file, reason: 'unreadable' });
      continue;
    }
    if (current !== undefined && mentions.some((mention) => current.includes(mention))) {
      pointed.add(onDiskPath(absolute));
      continue;
    }
    if (current !== undefined && importedFiles(cwd, current).some((imported) => pointed.has(imported))) continue;
    writes.push({ relative: file, existing: current !== undefined, absolute, appended: appendedLine(current ?? '', skillPointer(skillDir)) });
    pointed.add(onDiskPath(absolute));
  }
  // After the plain files, so a link to one of them finds it whichever of the two comes first.
  for (const { file, absolute, entry } of files) {
    if (entry?.isSymbolicLink() !== true || pointed.has(onDiskPath(absolute))) continue;
    const current = readOrUndefined(absolute);
    if (current !== undefined && mentions.some((mention) => current.includes(mention))) continue;
    links.push({ relative: file, target: realpathOfExisting(absolute) });
  }
  return { writes, links, obstacles };
}

function skillFile(skillDir: string): string {
  return `${skillDir}/${SKILL_NAME}/SKILL.md`;
}

/** On-disk paths of the files `content` pulls in with a Claude Code import, a line that is only `@path`. */
function importedFiles(cwd: string, content: string): string[] {
  return [...content.matchAll(/^@(\S+)[ \t]*\r?$/gmu)].map((match) => onDiskPath(path.resolve(cwd, match[1] ?? '')));
}

/** What to append so `line` is the last paragraph of `content`, in the file's line endings. */
function appendedLine(content: string, line: string): string {
  if (content === '') return `${line}\n`;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const gap = /\n\r?\n$/u.test(content) ? '' : content.endsWith('\n') ? eol : `${eol}${eol}`;
  return `${gap}${line}${eol}`;
}

/** The file's text, read only to look for the pointer; undefined when it cannot be read. */
function readOrUndefined(absolute: string): string | undefined {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return undefined;
  }
}

/** The entry at `target` without following a final symlink; undefined when missing or unreachable. */
function lstatOrUndefined(target: string): Stats | undefined {
  try {
    return lstatSync(target);
  } catch {
    return undefined;
  }
}
