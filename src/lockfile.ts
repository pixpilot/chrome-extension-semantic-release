import type { CommandRunner } from './commands';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';

import { DEPENDENCY_FIELDS } from './workspace';

// Only pnpm's lockfile records dependency versions per workspace package in a
// simple structure; other package managers fall back to file changes alone.
export const LOCKFILE_NAME = 'pnpm-lock.yaml';

/** Which lockfile to read, and which of its importers to compare. */
export interface LockfileScope {
  /** Repository-relative path of pnpm-lock.yaml. */
  readonly path: string;
  /** Package folders relative to the lockfile's folder, `.` for that folder. */
  readonly importers: readonly string[];
}

/** Whether the workspace at `workspaceRoot` has a lockfile this module can read. */
export async function hasLockfile(workspaceRoot: string): Promise<boolean> {
  return access(path.join(workspaceRoot, LOCKFILE_NAME)).then(
    () => true,
    () => false,
  );
}

type LockedDependency = string | { version?: unknown };
type Importer = Partial<
  Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, LockedDependency>>
>;

/**
 * Lists commits after `from` (or in all history) that changed the locked
 * version of a dependency of one of the scope's importers. Workspace links and
 * peer-dependency suffixes are ignored, so a lockfile rewrite that leaves every
 * version alone does not count.
 */
export async function listCommitsChangingDependencies(
  run: CommandRunner,
  repositoryRoot: string,
  from: string | undefined,
  scope: LockfileScope,
): Promise<Set<string>> {
  const range = from === undefined ? 'HEAD' : `${from}..HEAD`;
  const output = await run(
    'git',
    ['log', '--format=%H %P', '--no-merges', range, '--', scope.path],
    repositoryRoot,
  );
  // Keyed by commit, so consecutive lockfile commits parse each revision once.
  const fingerprints = new Map<string, Promise<string>>();
  const fingerprint = async (revision: string | undefined): Promise<string> => {
    if (revision === undefined) return '';
    if (!fingerprints.has(revision)) {
      fingerprints.set(revision, readFingerprint(run, repositoryRoot, revision, scope));
    }
    return fingerprints.get(revision)!;
  };
  const changed = new Set<string>();

  // One commit at a time: each parsed lockfile can be megabytes.
  for (const line of output.split('\n').filter(Boolean)) {
    const [hash, parent] = line.split(' ') as [string, string | undefined];
    // eslint-disable-next-line no-await-in-loop -- bounded memory, see above
    const [before, after] = await Promise.all([fingerprint(parent), fingerprint(hash)]);
    if (before !== after) changed.add(hash);
  }

  return changed;
}

/** The scope's locked dependency versions at `revision`, as one comparable string. */
async function readFingerprint(
  run: CommandRunner,
  repositoryRoot: string,
  revision: string,
  scope: LockfileScope,
): Promise<string> {
  let text: string;

  try {
    text = await run('git', ['show', `${revision}:${scope.path}`], repositoryRoot);
  } catch {
    return '';
  }

  const lockfile = load(text) as { importers?: Record<string, Importer> } | null;
  const importers = lockfile?.importers ?? {};

  return JSON.stringify(
    scope.importers.map((importer) =>
      DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries(importers[importer]?.[field] ?? {}).flatMap(([name, locked]) => {
          // Lockfile v5 stores the version directly; v6 and later nest it.
          const version = String(typeof locked === 'string' ? locked : locked.version);
          return version.startsWith('link:') ? [] : [`${name}@${version.split('(')[0]}`];
        }),
      ).sort(),
    ),
  );
}
