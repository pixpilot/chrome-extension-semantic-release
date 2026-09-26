import type { StoreCredentials } from './chrome-web-store';
import * as core from '@actions/core';

/* eslint-disable no-template-curly-in-string -- semantic-release templates */
export const DEFAULT_TAG_FORMAT = 'v${version}';
export const DEFAULT_COMMIT_MESSAGE =
  'chore(release): ${nextRelease.gitTag} [skip ci]\n\n${nextRelease.notes}';
/* eslint-enable no-template-curly-in-string */

/** Validated action inputs. Paths are still as the caller wrote them. */
export interface ActionInputs {
  readonly workingDirectory: string;
  /** Extra paths whose commits count, on top of the package and its workspace dependencies. */
  readonly paths: readonly string[];
  readonly workspaceDependencies: boolean;
  readonly ignoreWorkspacePackages: readonly string[];
  readonly dependencyUpdates: boolean;
  readonly branches: readonly string[];
  readonly tagFormat: string;
  readonly manifest: string;
  readonly buildCommand: string;
  readonly package: string;
  /** Absent when `upload` is false. */
  readonly store: StoreCredentials | undefined;
  readonly submit: boolean;
  readonly commit: boolean;
  readonly commitMessage: string;
  readonly changelogFile: string;
  readonly githubRelease: boolean;
  readonly githubToken: string;
  readonly dryRun: boolean;
}

/** Splits a newline- or comma-separated input into distinct, non-empty entries. */
export function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/u)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

export function readInputs(): ActionInputs {
  const workingDirectory = core.getInput('working-directory') || '.';
  const branches = parseList(core.getInput('branches'));
  const upload = readBoolean('upload', true);
  const packageInput = core.getInput('package');

  if (upload && !packageInput) {
    throw new Error('The "package" input is required when "upload" is true.');
  }

  return {
    workingDirectory,
    paths: parseList(core.getInput('paths')),
    workspaceDependencies: readBoolean('workspace-dependencies', true),
    ignoreWorkspacePackages: parseList(core.getInput('ignore-workspace-packages')),
    dependencyUpdates: readBoolean('dependency-updates', true),
    branches: branches.length > 0 ? branches : ['main'],
    tagFormat: core.getInput('tag-format') || DEFAULT_TAG_FORMAT,
    manifest: core.getInput('manifest'),
    buildCommand: core.getInput('build-command'),
    package: packageInput,
    store: upload ? readStoreCredentials() : undefined,
    submit: readBoolean('submit', true),
    commit: readBoolean('commit', true),
    commitMessage: core.getInput('commit-message') || DEFAULT_COMMIT_MESSAGE,
    changelogFile: core.getInput('changelog-file'),
    githubRelease: readBoolean('github-release', true),
    githubToken: core.getInput('github-token', { required: true }),
    dryRun: readBoolean('dry-run', false),
  };
}

// `getBooleanInput` throws on an empty value, which is what an input without a
// default reads as outside the runner (tests, local-action).
function readBoolean(name: string, fallback: boolean): boolean {
  return core.getInput(name) ? core.getBooleanInput(name) : fallback;
}

// Every missing value is reported at once, so a misconfigured environment takes
// one run to fix.
function readStoreCredentials(): StoreCredentials {
  const names = {
    extensionId: 'extension-id',
    publisherId: 'publisher-id',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
  } as const;
  const values = Object.fromEntries(
    Object.entries(names).map(([key, input]) => [key, core.getInput(input)]),
  ) as Record<keyof typeof names, string>;
  const missing = Object.entries(names)
    .filter(([key]) => !values[key as keyof typeof names])
    .map(([, input]) => input);

  if (missing.length > 0) {
    throw new Error(
      `Uploading to the Chrome Web Store needs these inputs: ${missing.join(', ')}. Set "upload: false" to release without the store.`,
    );
  }

  core.setSecret(values.clientSecret);
  core.setSecret(values.refreshToken);

  return values;
}
