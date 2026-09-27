import type { LastRelease, Options, Result } from 'semantic-release';
import type { ChromeWebStore, StoreCredentials } from './chrome-web-store';
import type { CommandRunner, ShellRunner } from './commands';
import type { ActionInputs } from './inputs';
import type { LockfileScope } from './lockfile';
import type { Plugin } from './plugins/named-plugin';
import path from 'node:path';
import process from 'node:process';
import * as changelog from '@semantic-release/changelog';
import * as git from '@semantic-release/git';
import * as github from '@semantic-release/github';
import semanticRelease from 'semantic-release';

import { createChromeWebStore } from './chrome-web-store';
import { executeCommand, executeShell } from './commands';
import { hasLockfile, LOCKFILE_NAME } from './lockfile';
import { createCommitFilterPlugin } from './plugins/commit-filter';
import { createExtensionPlugin } from './plugins/extension';
import { namedPlugin } from './plugins/named-plugin';
import { getOriginUrl, getRepositoryRoot, toRepositoryPath } from './repository';
import {
  collectWorkspaceFolders,
  findWorkspacePackages,
  findWorkspaceRoot,
} from './workspace';

/** What happened, in the shape of the action outputs. */
export interface ReleaseOutcome {
  readonly released: boolean;
  /** The version released, or in a dry run the version that would be. */
  readonly version: string;
  readonly previousVersion: string;
  readonly tag: string;
  readonly type: string;
  readonly notes: string;
  /** Repository-relative path of the uploaded package. */
  readonly packagePath: string;
}

export interface ReleaseDependencies {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: CommandRunner;
  readonly runShell: ShellRunner;
  readonly createStore: (credentials: StoreCredentials) => ChromeWebStore;
  readonly semanticRelease: typeof semanticRelease;
}

const defaultDependencies: ReleaseDependencies = {
  cwd: process.cwd(),
  env: process.env,
  run: executeCommand,
  runShell: executeShell,
  createStore: createChromeWebStore,
  semanticRelease,
};

export async function release(
  inputs: ActionInputs,
  dependencies: ReleaseDependencies = defaultDependencies,
): Promise<ReleaseOutcome> {
  const { run, cwd } = dependencies;
  const workingDirectory = path.resolve(cwd, inputs.workingDirectory);
  const repositoryRoot = await getRepositoryRoot(run, workingDirectory);
  const fromPackage = (value: string): string => path.resolve(workingDirectory, value);
  const fromRoot = (file: string): string =>
    toRepositoryPath(repositoryRoot, repositoryRoot, file);

  const packageJson = fromPackage('package.json');
  const manifest = inputs.manifest ? fromPackage(inputs.manifest) : undefined;
  const changelogFile = inputs.changelogFile
    ? fromPackage(inputs.changelogFile)
    : undefined;
  const extension = createExtensionPlugin({
    run,
    runShell: dependencies.runShell,
    repositoryRoot,
    workingDirectory,
    packageJson,
    manifest,
    buildCommand: inputs.buildCommand,
    packagePath: inputs.package ? fromPackage(inputs.package) : '',
    store: inputs.store && dependencies.createStore(inputs.store),
    submit: inputs.submit,
    tagFormat: inputs.tagFormat,
  });

  const workspace = await resolveWorkspace(inputs, workingDirectory, repositoryRoot);
  const paths = [
    ...new Set([
      ...workspace.folders.map(fromRoot),
      ...inputs.paths.map((value) => toRepositoryPath(repositoryRoot, cwd, value)),
    ]),
  ];
  const lockfile = inputs.dependencyUpdates
    ? await findLockfileScope(workspace, repositoryRoot)
    : undefined;

  // Order matters within each step: the package is uploaded before the
  // changelog is written and before anything is committed.
  const plugins: [Plugin, object][] = [
    [
      createCommitFilterPlugin({
        run,
        repositoryRoot,
        paths,
        lockfile,
      }),
      {},
    ],
    [extension.plugin, {}],
  ];

  if (changelogFile !== undefined) {
    plugins.push([
      namedPlugin('@semantic-release/changelog', changelog),
      { changelogFile: fromRoot(changelogFile) },
    ]);
  }

  if (inputs.commit) {
    plugins.push([
      namedPlugin('@semantic-release/git', git),
      {
        assets: [packageJson, manifest, changelogFile]
          .filter((file): file is string => file !== undefined)
          .map(fromRoot),
        message: inputs.commitMessage,
      },
    ]);
  }

  if (inputs.githubRelease) {
    // Comments and labels on every included pull request are noise in a
    // monorepo, and failures are already reported by the workflow run.
    plugins.push([
      namedPlugin('@semantic-release/github', github),
      { successComment: false, failCommentCondition: false, releasedLabels: false },
    ]);
  }

  // The origin remote is always this repository; a package.json `repository`
  // field in a monorepo app can point anywhere.
  const repositoryUrl = await getOriginUrl(run, repositoryRoot);
  const result = await dependencies.semanticRelease(
    {
      branches: [...inputs.branches],
      tagFormat: inputs.tagFormat,
      dryRun: inputs.dryRun,
      plugins: plugins as unknown as Options['plugins'],
      ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
    },
    {
      cwd: repositoryRoot,
      env: {
        ...dependencies.env,
        GITHUB_TOKEN: inputs.githubToken,
        GH_TOKEN: inputs.githubToken,
      },
      stdout: process.stdout,
      stderr: process.stderr,
    },
  );

  const packagePath = extension.getPackagePath();
  return toOutcome(
    result,
    inputs.dryRun,
    packagePath === undefined ? '' : fromRoot(packagePath),
  );
}

interface Workspace {
  /** The workspace root, or `undefined` for a package outside any workspace. */
  readonly root: string | undefined;
  /**
   * The extension's folder and, unless turned off, the folders of the workspace
   * packages it depends on. Absolute.
   */
  readonly folders: readonly string[];
}

async function resolveWorkspace(
  inputs: ActionInputs,
  workingDirectory: string,
  repositoryRoot: string,
): Promise<Workspace> {
  const root = await findWorkspaceRoot(workingDirectory, repositoryRoot);

  if (!inputs.workspaceDependencies) return { root, folders: [workingDirectory] };

  const packages =
    root === undefined ? new Map<string, string>() : await findWorkspacePackages(root);
  // A typo would silently count the package it meant to leave out.
  const unknown = inputs.ignoreWorkspacePackages.filter((name) => !packages.has(name));

  if (unknown.length > 0) {
    throw new Error(
      `"ignore-workspace-packages" names packages that are not in the workspace: ${unknown.join(', ')}.`,
    );
  }

  return {
    root,
    folders: await collectWorkspaceFolders(
      workingDirectory,
      packages,
      inputs.ignoreWorkspacePackages,
    ),
  };
}

// The lockfile sits at the workspace root, which need not be the repository
// root, and keys its importers by folder relative to itself.
async function findLockfileScope(
  { root, folders }: Workspace,
  repositoryRoot: string,
): Promise<LockfileScope | undefined> {
  if (root === undefined || !(await hasLockfile(root))) return undefined;

  return {
    path: toRepositoryPath(repositoryRoot, root, LOCKFILE_NAME),
    importers: folders.map((folder) => toRepositoryPath(root, root, folder)),
  };
}

function toOutcome(result: Result, dryRun: boolean, packagePath: string): ReleaseOutcome {
  // semantic-release resolves `false` when nothing is released, and an object
  // without `nextRelease` when it only added an existing release to a channel.
  if (result === false || !('nextRelease' in result)) {
    return {
      released: false,
      version: '',
      previousVersion: '',
      tag: '',
      type: '',
      notes: '',
      packagePath,
    };
  }

  const { lastRelease, nextRelease } = result;

  return {
    released: !dryRun,
    version: nextRelease.version,
    // The types promise a version, but there is none before the first release.
    previousVersion: (lastRelease as Partial<LastRelease>).version ?? '',
    tag: nextRelease.gitTag,
    type: nextRelease.type,
    notes: nextRelease.notes ?? '',
    packagePath,
  };
}
