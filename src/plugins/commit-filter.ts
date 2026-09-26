import type {
  AnalyzeCommitsContext,
  Commit,
  GenerateNotesContext,
} from 'semantic-release';
import type { CommandRunner } from '../commands';
import type { LockfileScope } from '../lockfile';
import type { Plugin } from './named-plugin';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import createPreset from 'conventional-changelog-conventionalcommits';

import { listCommitsChangingDependencies } from '../lockfile';
import { listCommitsTouchingPaths } from '../repository';
import { namedPlugin } from './named-plugin';

export interface CommitFilterOptions {
  readonly run: CommandRunner;
  readonly repositoryRoot: string;
  /** Repository-relative paths; `.` means every commit counts. */
  readonly paths: readonly string[];
  /** Whose locked dependency versions also count; `undefined` ignores the lockfile. */
  readonly lockfile: LockfileScope | undefined;
}

/**
 * Decides the release type and writes the release notes from Conventional
 * Commits, counting only commits that touched `paths` or changed a locked
 * dependency in `lockfile`. In a monorepo this keeps another app's `feat!:`
 * from bumping the extension.
 */
export function createCommitFilterPlugin({
  run,
  repositoryRoot,
  paths,
  lockfile,
}: CommitFilterOptions): Plugin {
  const preset = createPreset();
  // The Conventional Commits preset understands `feat!:`; the default Angular
  // preset does not even parse that header. `preset` and `config` are cleared so
  // a semantic-release config file in the repository cannot swap the preset for
  // a module that is not bundled.
  const presetConfig = {
    preset: undefined,
    config: undefined,
    parserOpts: preset.parser,
    writerOpts: preset.writer,
  };
  const filterAll = paths.includes('.');
  // semantic-release asks again for notes after the release commit; the answer
  // for the same last release does not change, and the lockfile scan is slow.
  const counted = new Map<string, Promise<Set<string>>>();

  async function countedHashes(from: string | undefined): Promise<Set<string>> {
    const [touching, locked] = await Promise.all([
      listCommitsTouchingPaths(run, repositoryRoot, from, paths),
      lockfile === undefined
        ? new Set<string>()
        : listCommitsChangingDependencies(run, repositoryRoot, from, lockfile),
    ]);
    return new Set([...touching, ...locked]);
  }

  async function relevantCommits(context: AnalyzeCommitsContext): Promise<Commit[]> {
    if (filterAll) return [...context.commits];

    const from = context.lastRelease.gitHead;
    const key = from ?? '';
    if (!counted.has(key)) counted.set(key, countedHashes(from));

    const hashes = await counted.get(key)!;
    return context.commits.filter((commit) => hashes.has(commit.hash));
  }

  return namedPlugin('path-filtered conventional commits', {
    async analyzeCommits(_pluginConfig: object, context: AnalyzeCommitsContext) {
      const commits = await relevantCommits(context);

      if (!filterAll) {
        context.logger.log(
          `Counting %d of %d commits that touched %s${lockfile === undefined ? '' : ' or changed their locked dependencies'}`,
          commits.length,
          context.commits.length,
          paths.join(', '),
        );
      }

      return analyzeCommits(presetConfig, { ...context, commits });
    },

    async generateNotes(_pluginConfig: object, context: GenerateNotesContext) {
      return generateNotes(presetConfig, {
        ...context,
        commits: await relevantCommits(context),
      });
    },
  });
}
