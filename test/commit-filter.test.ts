import type { CommandRunner } from '../src/commands';
import { describe, expect, it, vi } from 'vitest';

import { createCommitFilterPlugin } from '../src/plugins/commit-filter';

// The real commit analyzer and notes generator run here, so these tests also
// pin the Conventional Commits behaviour: `!` is breaking, feat is minor.
function createContext(messages: Record<string, string>) {
  return {
    commits: Object.entries(messages).map(([hash, message]) => ({
      hash,
      message,
      commit: { long: hash, short: hash.slice(0, 7) },
      committerDate: '2026-09-26T00:00:00Z',
    })),
    lastRelease: { gitHead: 'base', gitTag: 'ext-v1.0.0', version: '1.0.0' },
    nextRelease: { version: '2.0.0', gitTag: 'ext-v2.0.0', gitHead: 'head' },
    options: { repositoryUrl: 'https://github.com/pixpilot/roleclick.git' },
    cwd: process.cwd(),
    logger: { log: vi.fn() },
  };
}

function gitReturning(hashes: string[]) {
  return vi.fn<CommandRunner>(async () => hashes.join('\n'));
}

describe('createCommitFilterPlugin', () => {
  it('ignores commits that did not touch the paths', async () => {
    const run = gitReturning(['fix-ext']);
    const plugin = createCommitFilterPlugin({
      run,
      repositoryRoot: '/repo',
      paths: ['apps/ext'],
      lockfile: undefined,
    });
    const context = createContext({
      'feat-web': 'feat(web)!: redesign the dashboard',
      'fix-ext': 'fix(ext): keep the popup open',
    });

    await expect(plugin.analyzeCommits({}, context as never)).resolves.toBe('patch');
    expect(run).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['base..HEAD', '--', 'apps/ext']),
      '/repo',
    );
  });

  it.each([
    ['feat(jobs)!: add structured metadata', 'major'],
    ['feat: add metadata\n\nBREAKING CHANGE: storage format changed', 'major'],
    ['feat(jobs): add metadata', 'minor'],
    ['perf: faster capture', 'patch'],
    ['chore(deps): bump vite', null],
  ])('releases %j as %s', async (message, expected) => {
    const run = gitReturning([]);
    const plugin = createCommitFilterPlugin({
      run,
      repositoryRoot: '/repo',
      paths: ['.'],
      lockfile: undefined,
    });

    await expect(
      plugin.analyzeCommits({}, createContext({ a: message }) as never),
    ).resolves.toBe(expected);
    expect(run).not.toHaveBeenCalled();
  });

  it('writes notes from the counted commits only', async () => {
    const plugin = createCommitFilterPlugin({
      run: gitReturning(['feat-ext']),
      repositoryRoot: '/repo',
      paths: ['apps/ext'],
      lockfile: undefined,
    });
    const context = createContext({
      'feat-ext': 'feat(ext): capture salaries',
      'fix-web': 'fix(web): login redirect',
    });

    const notes = await plugin.generateNotes({}, context as never);

    expect(notes).toContain('capture salaries');
    expect(notes).not.toContain('login redirect');
  });

  it('also counts commits that changed a locked dependency, scanning once', async () => {
    const lockfile = (version: string) =>
      `importers:\n  apps/ext:\n    dependencies:\n      react:\n        version: ${version}\n`;
    const run = vi.fn<CommandRunner>(async (_command, arguments_) => {
      if (arguments_.includes('pnpm-lock.yaml')) return 'fix-deps base\n';
      if (arguments_[0] === 'show') {
        return lockfile(arguments_[1].startsWith('fix-deps') ? '19.3.0' : '19.2.7');
      }
      return '';
    });
    const plugin = createCommitFilterPlugin({
      run,
      repositoryRoot: '/repo',
      paths: ['apps/ext'],
      lockfile: { path: 'pnpm-lock.yaml', importers: ['apps/ext'] },
    });
    const context = createContext({
      'fix-deps': 'fix(deps): patch react',
      'feat-web': 'feat(web): new page',
    });

    await expect(plugin.analyzeCommits({}, context as never)).resolves.toBe('patch');
    await plugin.generateNotes({}, context as never);

    const lockfileScans = run.mock.calls.filter(([, arguments_]) =>
      arguments_.includes('pnpm-lock.yaml'),
    );
    expect(lockfileScans).toHaveLength(1);
  });
});
