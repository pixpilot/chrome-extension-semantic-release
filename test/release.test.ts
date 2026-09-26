/* eslint-disable no-template-curly-in-string -- semantic-release tag templates */
import type { CommandRunner } from '../src/commands';
import type { ActionInputs } from '../src/inputs';
import type { ReleaseDependencies } from '../src/release';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_COMMIT_MESSAGE } from '../src/inputs';
import { release } from '../src/release';

const root = path.resolve('/workspace');

const inputs: ActionInputs = {
  workingDirectory: 'apps/ext',
  paths: ['apps/ext', 'packages/ui'],
  branches: ['main'],
  tagFormat: 'ext-v${version}',
  manifest: '',
  buildCommand: 'pnpm run zip',
  package: 'package',
  store: {
    extensionId: 'ext-id',
    publisherId: 'pub-id',
    clientId: 'client',
    clientSecret: 'secret',
    refreshToken: 'refresh',
  },
  submit: true,
  commit: true,
  commitMessage: DEFAULT_COMMIT_MESSAGE,
  changelogFile: 'CHANGELOG.md',
  githubRelease: true,
  githubToken: 'app-token',
  dryRun: false,
};

const released = {
  lastRelease: {
    version: '2.0.0',
    gitTag: 'ext-v2.0.0',
    gitHead: 'a',
    channels: [],
    name: '',
  },
  commits: [],
  releases: [],
  nextRelease: {
    version: '2.1.0',
    gitTag: 'ext-v2.1.0',
    gitHead: 'b',
    name: 'ext-v2.1.0',
    type: 'minor' as const,
    channel: '',
    notes: '## 2.1.0',
  },
};

function createDependencies(result: unknown = released) {
  const run = vi.fn<CommandRunner>(async (_command, arguments_) =>
    arguments_[0] === 'remote' ? 'https://github.com/pixpilot/roleclick\n' : `${root}\n`,
  );
  const semanticRelease = vi.fn(async () => result);
  const createStore = vi.fn(() => ({
    itemUrl: '',
    verify: vi.fn(),
    upload: vi.fn(),
    submit: vi.fn(),
  }));
  const dependencies = {
    cwd: root,
    env: { HOME: '/home/runner' },
    run,
    runShell: vi.fn(),
    createStore,
    semanticRelease,
  } as unknown as ReleaseDependencies;

  return { dependencies, semanticRelease, createStore };
}

function pluginNames(
  plugins: [Record<string, { pluginName: string }>, object][],
): string[] {
  return plugins.map(([plugin]) => Object.values(plugin)[0].pluginName);
}

describe('release', () => {
  it('runs semantic-release from the repository root with the release plugins in order', async () => {
    const { dependencies, semanticRelease, createStore } = createDependencies();

    await release(inputs, dependencies);

    const [options, config] = semanticRelease.mock.calls[0] as unknown as [
      Record<string, unknown> & {
        plugins: [Record<string, { pluginName: string }>, object][];
      },
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      branches: ['main'],
      tagFormat: 'ext-v${version}',
      dryRun: false,
      repositoryUrl: 'https://github.com/pixpilot/roleclick',
    });
    expect(pluginNames(options.plugins)).toEqual([
      'path-filtered conventional commits',
      'chrome extension',
      '@semantic-release/changelog',
      '@semantic-release/git',
      '@semantic-release/github',
    ]);
    expect(options.plugins[2][1]).toEqual({ changelogFile: 'apps/ext/CHANGELOG.md' });
    expect(options.plugins[3][1]).toEqual({
      assets: ['apps/ext/package.json', 'apps/ext/CHANGELOG.md'],
      message: DEFAULT_COMMIT_MESSAGE,
    });
    expect(options.plugins[4][1]).toMatchObject({
      successComment: false,
      failComment: false,
    });
    expect(config).toMatchObject({
      cwd: root,
      env: { HOME: '/home/runner', GITHUB_TOKEN: 'app-token', GH_TOKEN: 'app-token' },
    });
    expect(createStore).toHaveBeenCalledWith(inputs.store);
  });

  it('leaves out optional plugins and the store when they are turned off', async () => {
    const { dependencies, semanticRelease, createStore } = createDependencies();

    await release(
      {
        ...inputs,
        changelogFile: '',
        commit: false,
        githubRelease: false,
        store: undefined,
      },
      dependencies,
    );

    const [options] = semanticRelease.mock.calls[0] as unknown as [
      { plugins: [Record<string, { pluginName: string }>, object][] },
    ];
    expect(pluginNames(options.plugins)).toEqual([
      'path-filtered conventional commits',
      'chrome extension',
    ]);
    expect(createStore).not.toHaveBeenCalled();
  });

  it('reports the released version', async () => {
    const { dependencies } = createDependencies();

    await expect(release(inputs, dependencies)).resolves.toEqual({
      released: true,
      version: '2.1.0',
      previousVersion: '2.0.0',
      tag: 'ext-v2.1.0',
      type: 'minor',
      notes: '## 2.1.0',
      packagePath: '',
    });
  });

  it('reports the would-be version of a dry run as not released', async () => {
    const { dependencies } = createDependencies({ ...released, lastRelease: {} });

    await expect(
      release({ ...inputs, dryRun: true }, dependencies),
    ).resolves.toMatchObject({
      released: false,
      version: '2.1.0',
      previousVersion: '',
    });
  });

  it('reports nothing when there is no release', async () => {
    const { dependencies } = createDependencies(false);

    await expect(release(inputs, dependencies)).resolves.toMatchObject({
      released: false,
      version: '',
      tag: '',
    });
  });
});
