import type { CommandRunner } from '../src/commands';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  findVersionCommit,
  getOriginUrl,
  getRepositoryRoot,
  listCommitsTouchingPaths,
  toRepositoryPath,
} from '../src/repository';

const root = path.resolve('/repo');

describe('toRepositoryPath', () => {
  it('returns forward-slash paths relative to the repository root', () => {
    expect(toRepositoryPath(root, root, './apps/ext/')).toBe('apps/ext');
    expect(toRepositoryPath(root, path.join(root, 'apps/ext'), 'package.json')).toBe(
      'apps/ext/package.json',
    );
    expect(toRepositoryPath(root, root, path.join(root, 'packages', 'ui'))).toBe(
      'packages/ui',
    );
  });

  it('returns the root as "."', () => {
    expect(toRepositoryPath(root, root, '.')).toBe('.');
  });

  it('rejects paths outside the repository', () => {
    expect(() => toRepositoryPath(root, root, '../other')).toThrow(
      'outside the repository',
    );
  });
});

describe('listCommitsTouchingPaths', () => {
  it('lists commits since the last release that changed the paths', async () => {
    const run = vi.fn<CommandRunner>(async () => 'aaa\nbbb\n');

    await expect(
      listCommitsTouchingPaths(run, root, 'base', ['apps/ext', 'packages/ui']),
    ).resolves.toEqual(new Set(['aaa', 'bbb']));
    expect(run).toHaveBeenCalledWith(
      'git',
      [
        'log',
        '--format=%H',
        '--full-history',
        '--no-merges',
        'base..HEAD',
        '--',
        'apps/ext',
        'packages/ui',
      ],
      root,
    );
  });

  it('searches all history before the first release', async () => {
    const run = vi.fn<CommandRunner>(async () => '');

    await listCommitsTouchingPaths(run, root, undefined, ['apps/ext']);
    expect(run.mock.calls[0]?.[1]).toContain('HEAD');
    expect(run.mock.calls[0]?.[1]).not.toContain('undefined..HEAD');
  });
});

describe('git lookups', () => {
  it('resolves the repository root', async () => {
    const run = vi.fn<CommandRunner>(async () => `${root}\n`);
    await expect(getRepositoryRoot(run, path.join(root, 'apps'))).resolves.toBe(root);
  });

  it('returns undefined when origin or the version commit cannot be found', async () => {
    const run = vi.fn<CommandRunner>(async () => {
      throw new Error('no');
    });

    await expect(getOriginUrl(run, root)).resolves.toBeUndefined();
    await expect(findVersionCommit(run, root, 'package.json')).resolves.toBeUndefined();
  });

  it('returns the origin url and the version commit', async () => {
    const run = vi.fn<CommandRunner>(async (_command, arguments_) =>
      arguments_[0] === 'remote' ? 'https://github.com/o/r\n' : 'abc123\n',
    );

    await expect(getOriginUrl(run, root)).resolves.toBe('https://github.com/o/r');
    await expect(findVersionCommit(run, root, 'package.json')).resolves.toBe('abc123');
  });
});
