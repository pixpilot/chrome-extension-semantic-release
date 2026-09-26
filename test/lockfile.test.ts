import type { CommandRunner } from '../src/commands';
import { describe, expect, it, vi } from 'vitest';

import { listCommitsChangingDependencies } from '../src/lockfile';

function lockfile(importers: Record<string, string>): string {
  return `lockfileVersion: '9.0'\nimporters:\n${Object.entries(importers)
    .map(([folder, body]) => `  ${folder}:\n${body}`)
    .join('\n')}\n`;
}

const base = lockfile({
  'apps/ext': [
    '    dependencies:',
    '      react:',
    '        specifier: catalog:prod',
    '        version: 19.2.7',
    '      ui:',
    '        specifier: workspace:*',
    '        version: link:../../packages/ui',
    '    devDependencies:',
    '      vite:',
    '        specifier: ^7.0.0',
    '        version: 7.1.0(@types/node@25.0.0)',
  ].join('\n'),
  'apps/web': [
    '    dependencies:',
    '      next:',
    '        specifier: ^16.0.0',
    '        version: 16.0.0',
  ].join('\n'),
});

/**
 * A fake git history: `commits` lists each lockfile commit newest first, as
 * `hash parent`; `revisions` holds the lockfile at each commit.
 */
function createGit(commits: string[], revisions: Record<string, string>) {
  return vi.fn<CommandRunner>(async (_command, arguments_) => {
    if (arguments_[0] === 'log') return `${commits.join('\n')}\n`;

    const text = revisions[arguments_[1].replace(/:.*$/u, '')];
    if (text === undefined) throw new Error('fatal: path does not exist');
    return text;
  });
}

const scope = { path: 'pnpm-lock.yaml', importers: ['apps/ext'] };

describe('listCommitsChangingDependencies', () => {
  it('counts a changed version in any dependency field of the given folders', async () => {
    const run = createGit(['react h0', 'vite h0'], {
      h0: base,
      react: base.replace('version: 19.2.7', 'version: 19.3.0'),
      vite: base.replace('version: 7.1.0(', 'version: 7.2.0('),
    });

    await expect(
      listCommitsChangingDependencies(run, '/repo', 'last', scope),
    ).resolves.toEqual(new Set(['react', 'vite']));
    expect(run).toHaveBeenCalledWith(
      'git',
      ['log', '--format=%H %P', '--no-merges', 'last..HEAD', '--', 'pnpm-lock.yaml'],
      '/repo',
    );
  });

  it('ignores other folders, peer suffixes and workspace links', async () => {
    const run = createGit(['web h0', 'peer h0', 'link h0'], {
      h0: base,
      web: base.replace('version: 16.0.0', 'version: 16.1.0'),
      peer: base.replace('7.1.0(@types/node@25.0.0)', '7.1.0(@types/node@25.1.0)'),
      link: base.replace('link:../../packages/ui', 'link:../packages/ui'),
    });

    await expect(
      listCommitsChangingDependencies(run, '/repo', undefined, scope),
    ).resolves.toEqual(new Set());
    expect(run.mock.calls[0]?.[1]).toContain('HEAD');
  });

  it('reads lockfile v5 versions and a lockfile added by the commit', async () => {
    const v5 = (version: string) =>
      `lockfileVersion: 5.4\nimporters:\n  apps/ext:\n    dependencies:\n      react: ${version}\n`;
    const run = createGit(['bump added', 'added first'], {
      added: v5('18.2.0'),
      bump: v5('18.3.1'),
    });

    await expect(
      listCommitsChangingDependencies(run, '/repo', undefined, scope),
    ).resolves.toEqual(new Set(['bump', 'added']));
  });

  it('reads each revision once', async () => {
    const run = createGit(['h2 h1', 'h1 h0'], { h0: base, h1: base, h2: base });

    await listCommitsChangingDependencies(run, '/repo', undefined, scope);

    const shows = run.mock.calls.filter(([, arguments_]) => arguments_[0] === 'show');
    expect(shows).toHaveLength(3);
  });

  it('reads a lockfile below the repository root', async () => {
    const run = createGit(['react h0'], {
      h0: base,
      react: base.replace('version: 19.2.7', 'version: 19.3.0'),
    });

    await expect(
      listCommitsChangingDependencies(run, '/repo', undefined, {
        path: 'frontend/pnpm-lock.yaml',
        importers: ['apps/ext'],
      }),
    ).resolves.toEqual(new Set(['react']));
    expect(run.mock.calls[0]?.[1].at(-1)).toBe('frontend/pnpm-lock.yaml');
    expect(run).toHaveBeenCalledWith(
      'git',
      ['show', 'react:frontend/pnpm-lock.yaml'],
      '/repo',
    );
  });
});
