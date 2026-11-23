/** `e2e guide`: prints the bundled agent skill for agents and people who do not have it installed. */

import path from 'node:path';
import { detectWorkspacePackageManager, execCommand } from '../internal/package-manager.ts';
import { declaringPackage, installedPackage, RUNNER } from '../internal/project-package.ts';
import { parseVersion, specAccepts } from '../internal/semver.ts';
import { MISSING_SKILL_MESSAGE, packagedSkillDirectory, readGuide, skillTopics } from './skill.ts';

export interface GuideOptions {
  /** The version of the CLI that runs the command. */
  readonly version: string;
  /** The project directory; the working directory when absent. */
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface GuideSource {
  /** The skill directory to read, or undefined for this CLI's own. */
  readonly from: string | undefined;
  /** One line for stderr: the version the guide is for, and what to do when the project uses another. */
  readonly notice: string;
}

/**
 * Which copy of the guide matches the project in `cwd`. `npx e2e guide`
 * downloads the latest release when the project's own e2e is not installed
 * yet, and a global install is whatever it is, so the running CLI is not
 * always the version the tests will run on. An installed copy of another
 * version is read instead of this one, unless package.json has moved past
 * it to a range this CLI is in; a declared version with no installed copy
 * can only be named.
 */
function guideSource({ version, cwd = process.cwd(), env = process.env }: GuideOptions): GuideSource {
  const declared = declaringPackage(cwd, RUNNER);
  const installed = installedPackage(path.resolve(cwd), RUNNER);
  const accepts = (candidate: string): boolean | undefined => {
    const parsed = parseVersion(candidate);
    return declared === undefined || parsed === undefined ? undefined : specAccepts(declared.spec, parsed);
  };
  const own = { from: undefined, notice: `Guide for e2e ${version}` };
  if (declared === undefined) {
    if (installed === undefined || installed.version === version) return own;
    return installedGuide(installed, version, '');
  }
  const spec = declared.spec.trim();
  const manifest = path.relative(cwd, path.join(declared.dir, 'package.json'));
  const manager = detectWorkspacePackageManager(declared.dir, env).manager;
  if (installed === undefined) {
    if (accepts(version) !== false) return own;
    const pinned = parseVersion(spec) === undefined ? `"e2e@${spec}"` : `e2e@${spec}`;
    return {
      from: undefined,
      notice: `${own.notice}, but ${manifest} declares e2e ${spec} and no installed copy was found. For the matching guide, run \`${manager} install\` and then \`${execCommand(manager, 'e2e guide')}\`, or run \`npx ${pinned} guide\`.`,
    };
  }
  const stale = accepts(installed.version) === false;
  const reinstall = `${manifest} declares e2e ${spec}, which the installed e2e ${installed.version} is outside of; run \`${manager} install\``;
  if (installed.version === version) return stale ? { from: undefined, notice: `${own.notice}, but ${reinstall} for the matching guide` } : own;
  if (stale && accepts(version) === true) return { from: undefined, notice: `${own.notice}. ${reinstall}` };
  return installedGuide(installed, version, stale ? `. ${reinstall} for the matching guide` : '');
}

function installedGuide(installed: { dir: string; version: string }, version: string, suffix: string): GuideSource {
  const from = packagedSkillDirectory(installed.dir);
  return from === undefined
    ? { from, notice: `Guide for e2e ${version}; the project's installed e2e ${installed.version} ships no guide${suffix}` }
    : { from, notice: `Guide for e2e ${installed.version}, the version installed in this project (this CLI is e2e ${version})${suffix}` };
}

/**
 * Prints the overview or one topic to stdout, and the version it is for to
 * stderr, so stdout stays the guide alone; an unknown topic exits 2.
 */
export function guide(topic: string | undefined, options: GuideOptions): number {
  const { from, notice } = guideSource(options);
  const text = readGuide(topic, from);
  if (text === undefined) {
    const topics = skillTopics(from);
    // The topics are the read copy's, so the line that names its version comes first.
    process.stderr.write(topics.length === 0 ? `${MISSING_SKILL_MESSAGE}\n` : `${notice}\nunknown topic "${topic}"; topics: ${topics.join(', ')}\n`);
    return 2;
  }
  process.stderr.write(`${notice}\n`);
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  return 0;
}
