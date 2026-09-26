import type {
  AnalyzeCommitsContext,
  Commit,
  GenerateNotesContext,
} from 'semantic-release';
import type { CommandRunner } from '../commands';
import type { Plugin } from './named-plugin';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import createPreset from 'conventional-changelog-conventionalcommits';

import { listCommitsTouchingPaths } from '../repository';
import { namedPlugin } from './named-plugin';

export interface CommitFilterOptions {
  readonly run: CommandRunner;
  readonly repositoryRoot: string;
  /** Repository-relative paths; `.` means every commit counts. */
  readonly paths: readonly string[];
}

/**
 * Decides the release type and writes the release notes from Conventional
 * Commits, counting only commits that touched `paths`. In a monorepo this keeps
 * another app's `feat!:` from bumping the extension.
 */
export function createCommitFilterPlugin({
  run,
  repositoryRoot,
  paths,
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

  async function relevantCommits(context: AnalyzeCommitsContext): Promise<Commit[]> {
    if (filterAll) return [...context.commits];

    const touching = await listCommitsTouchingPaths(
      run,
      repositoryRoot,
      context.lastRelease.gitHead,
      paths,
    );
    return context.commits.filter((commit) => touching.has(commit.hash));
  }

  return namedPlugin('path-filtered conventional commits', {
    async analyzeCommits(_pluginConfig: object, context: AnalyzeCommitsContext) {
      const commits = await relevantCommits(context);

      if (!filterAll) {
        context.logger.log(
          'Counting %d of %d commits that touched %s',
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
