/* eslint-disable no-template-curly-in-string -- semantic-release tag templates */
import type { CommandRunner } from '../src/commands';
import type { ActionInputs } from '../src/inputs';
import type { ReleaseDependencies } from '../src/release';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_COMMIT_MESSAGE } from '../src/inputs';
import { release } from '../src/release';

const root = path.resolve('/workspace');

const inputs: ActionInputs = {
  workingDirectory: 'apps/ext',
  paths: [],
  workspaceDependencies: true,
  ignoreWorkspacePackages: [],
  dependencyUpdates: true,
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

function createDependencies(result: unknown = released, repositoryRoot = root) {
  const run = vi.fn<CommandRunner>(async (_command, arguments_) => {
    if (arguments_[0] === 'remote') return 'https://github.com/pixpilot/roleclick\n';
    if (arguments_[0] === 'rev-parse') return `${repositoryRoot}\n`;
    return '';
  });
  const semanticRelease = vi.fn(async () => result);
  const createStore = vi.fn(() => ({
    itemUrl: '',
    verify: vi.fn(),
    upload: vi.fn(),
    submit: vi.fn(),
  }));
  const dependencies = {
    cwd: repositoryRoot,
    env: { HOME: '/home/runner' },
    run,
    runShell: vi.fn(),
    createStore,
    semanticRelease,
  } as unknown as ReleaseDependencies;

  return { dependencies, semanticRelease, createStore, run };
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

describe('release in a workspace', () => {
  interface WorkspaceOptions {
    readonly lockfile: boolean;
    /** Folder of the workspace inside the repository; the root by default. */
    readonly under?: string;
  }

  // Returns the repository root.
  async function createWorkspace(options: WorkspaceOptions): Promise<string> {
    const repository = await mkdtemp(path.join(tmpdir(), 'release-workspace-'));
    const workspace = path.join(repository, options.under ?? '');
    const writePackage = async (folder: string, manifest: object) => {
      await mkdir(path.join(workspace, folder), { recursive: true });
      await writeFile(
        path.join(workspace, folder, 'package.json'),
        JSON.stringify(manifest),
      );
    };

    await mkdir(workspace, { recursive: true });
    await writeFile(
      path.join(workspace, 'pnpm-workspace.yaml'),
      'packages: [apps/*, packages/*]',
    );
    if (options.lockfile)
      await writeFile(path.join(workspace, 'pnpm-lock.yaml'), 'importers: {}');
    await writePackage('apps/ext', {
      name: 'ext',
      dependencies: { ui: 'workspace:*' },
      devDependencies: { api: 'workspace:*' },
    });
    await writePackage('packages/ui', { name: 'ui' });
    await writePackage('packages/api', { name: 'api' });
    return repository;
  }

  // Runs the commit filter semantic-release was given and returns the git
  // commands it issued.
  async function analyze(
    workspaceInputs: Partial<ActionInputs>,
    options: WorkspaceOptions,
  ): Promise<string[][]> {
    const workspace = await createWorkspace(options);
    try {
      const { dependencies, semanticRelease, run } = createDependencies(
        released,
        workspace,
      );
      await release({ ...inputs, ...workspaceInputs }, dependencies);

      const [{ plugins }] = semanticRelease.mock.calls[0] as unknown as [
        {
          plugins: [
            Record<string, (config: object, context: object) => unknown>,
            object,
          ][];
        },
      ];
      run.mockClear();
      await plugins[0][0].analyzeCommits(
        {},
        {
          commits: [],
          lastRelease: { gitHead: 'last' },
          logger: { log: vi.fn() },
        },
      );
      return run.mock.calls.map(([, arguments_]) => [...arguments_]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  it('counts the workspace packages the extension depends on, minus ignored ones', async () => {
    const calls = await analyze({ ignoreWorkspacePackages: ['api'] }, { lockfile: true });

    const pathLog = calls.find((call) => call.includes('--full-history'))!;
    expect(pathLog.slice(pathLog.indexOf('--') + 1)).toEqual(['apps/ext', 'packages/ui']);
    expect(calls.some((call) => call.includes('pnpm-lock.yaml'))).toBe(true);
  });

  it('finds a workspace and its lockfile below the repository root', async () => {
    const calls = await analyze(
      { workingDirectory: 'frontend/apps/ext', ignoreWorkspacePackages: ['api'] },
      { lockfile: true, under: 'frontend' },
    );

    const pathLog = calls.find((call) => call.includes('--full-history'))!;
    expect(pathLog.slice(pathLog.indexOf('--') + 1)).toEqual([
      'frontend/apps/ext',
      'frontend/packages/ui',
    ]);
    expect(calls.some((call) => call.at(-1) === 'frontend/pnpm-lock.yaml')).toBe(true);
  });

  it('skips the lockfile scan without pnpm-lock.yaml or when turned off', async () => {
    for (const [workspaceInputs, options] of [
      [{}, { lockfile: false }],
      [{ dependencyUpdates: false }, { lockfile: true }],
    ] as const) {
      const calls = await analyze(workspaceInputs, options);
      expect(calls.some((call) => call.includes('pnpm-lock.yaml'))).toBe(false);
    }
  });

  it('counts only the extension folder and extra paths when workspace dependencies are off', async () => {
    const calls = await analyze(
      { workspaceDependencies: false, paths: ['shared/assets'] },
      { lockfile: false },
    );

    const pathLog = calls.find((call) => call.includes('--full-history'))!;
    expect(pathLog.slice(pathLog.indexOf('--') + 1)).toEqual([
      'apps/ext',
      'shared/assets',
    ]);
  });

  it('rejects an ignored package that is not in the workspace', async () => {
    const workspace = await createWorkspace({ lockfile: false });
    try {
      const { dependencies } = createDependencies(released, workspace);
      await expect(
        release({ ...inputs, ignoreWorkspacePackages: ['@typo/api'] }, dependencies),
      ).rejects.toThrow('not in the workspace: @typo/api');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
