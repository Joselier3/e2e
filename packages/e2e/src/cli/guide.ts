/** `e2e guide`: prints the bundled agent skill for agents and people who do not have it installed. */

import path from 'node:path';
import { detectWorkspacePackageManager, execCommand } from '../internal/package-manager.ts';
import { declaringPackage, installedPackage } from '../internal/project-package.ts';
import { parseVersion, specAccepts } from '../internal/semver.ts';
import { MISSING_SKILL_MESSAGE, packagedSkillDirectory, readGuide, skillTopics } from './skill.ts';

const RUNNER = 'e2e';

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
 * version is read instead of this one; a declared version that is not
 * installed can only be named.
 */
function guideSource({ version, cwd = process.cwd(), env = process.env }: GuideOptions): GuideSource {
  const declared = declaringPackage(cwd, RUNNER);
  const installed = installedPackage(path.resolve(cwd), RUNNER);
  if (installed !== undefined) {
    if (installed.version === version) return { from: undefined, notice: `Guide for e2e ${version}` };
    const from = packagedSkillDirectory(installed.dir);
    return from === undefined
      ? { from, notice: `Guide for e2e ${version}; the project's installed e2e ${installed.version} ships no guide` }
      : { from, notice: `Guide for e2e ${installed.version}, the version installed in this project (this CLI is e2e ${version})` };
  }
  const running = parseVersion(version);
  if (declared === undefined || running === undefined || specAccepts(declared.spec, running) !== false) {
    return { from: undefined, notice: `Guide for e2e ${version}` };
  }
  const spec = declared.spec.trim();
  const manifest = path.relative(cwd, path.join(declared.dir, 'package.json'));
  const manager = detectWorkspacePackageManager(declared.dir, env).manager;
  const pinned = parseVersion(spec) === undefined ? `"e2e@${spec}"` : `e2e@${spec}`;
  return {
    from: undefined,
    notice: `Guide for e2e ${version}, but ${manifest} declares e2e ${spec}, which is not installed. For the matching guide, run \`${manager} install\` and then \`${execCommand(manager, 'e2e guide')}\`, or run \`npx ${pinned} guide\`.`,
  };
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
    process.stderr.write(
      topics.length === 0
        ? `${MISSING_SKILL_MESSAGE}\n`
        : `unknown topic "${topic}"; topics: ${topics.join(', ')}\n`,
    );
    return 2;
  }
  process.stderr.write(`${notice}\n`);
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  return 0;
}
