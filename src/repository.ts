import type { CommandRunner } from './commands';
import path from 'node:path';

/** Returns the root of the Git work tree that contains `cwd`. */
export async function getRepositoryRoot(
  run: CommandRunner,
  cwd: string,
): Promise<string> {
  const root = await run('git', ['rev-parse', '--show-toplevel'], cwd);
  return path.resolve(root.trim());
}

/** Returns the `origin` remote URL, or `undefined` when there is none. */
export async function getOriginUrl(
  run: CommandRunner,
  repositoryRoot: string,
): Promise<string | undefined> {
  try {
    const url = (
      await run('git', ['remote', 'get-url', 'origin'], repositoryRoot)
    ).trim();
    return url === '' ? undefined : url;
  } catch {
    return undefined;
  }
}

/**
 * Resolves `value` against `base` and returns it relative to the repository
 * root with forward slashes, which is what Git pathspecs and semantic-release
 * assets expect. The repository root itself is returned as `.`.
 */
export function toRepositoryPath(
  repositoryRoot: string,
  base: string,
  value: string,
): string {
  const relative = path.relative(repositoryRoot, path.resolve(base, value));

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`"${value}" resolves outside the repository at ${repositoryRoot}.`);
  }

  return relative.split(path.sep).join('/') || '.';
}

/**
 * Lists commits after `from` (or all history when there is no earlier release)
 * that changed at least one of `paths`. Merge commits never match, so a merged
 * branch counts through its own commits.
 */
export async function listCommitsTouchingPaths(
  run: CommandRunner,
  repositoryRoot: string,
  from: string | undefined,
  paths: readonly string[],
): Promise<Set<string>> {
  const range = from === undefined ? 'HEAD' : `${from}..HEAD`;
  const output = await run(
    'git',
    ['log', '--format=%H', '--full-history', '--no-merges', range, '--', ...paths],
    repositoryRoot,
  );

  return new Set(output.split('\n').filter(Boolean));
}

/** Finds the latest commit that changed the `"version"` line of a JSON file. */
export async function findVersionCommit(
  run: CommandRunner,
  repositoryRoot: string,
  file: string,
): Promise<string | undefined> {
  try {
    const output = await run(
      'git',
      ['log', '-1', '--format=%H', '-G', '"version"[[:space:]]*:', '--', file],
      repositoryRoot,
    );
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}
