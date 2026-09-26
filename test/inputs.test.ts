/* eslint-disable no-template-curly-in-string -- semantic-release tag templates */
import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COMMIT_MESSAGE, parseList, readInputs } from '../src/inputs';

vi.mock('@actions/core');

const storeInputs = {
  'extension-id': 'ext-id',
  'publisher-id': 'pub-id',
  'client-id': 'client',
  'client-secret': 'secret',
  'refresh-token': 'refresh',
};

function useInputs(values: Record<string, string>): void {
  vi.mocked(core.getInput).mockImplementation((name: string) => values[name] ?? '');
  vi.mocked(core.getBooleanInput).mockImplementation(
    (name: string) => values[name] === 'true',
  );
}

describe('parseList', () => {
  it('splits on newlines and commas and removes blanks and duplicates', () => {
    expect(parseList('apps/ext\n packages/ui , apps/ext,\n')).toEqual([
      'apps/ext',
      'packages/ui',
    ]);
  });
});

describe('readInputs', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('applies defaults, following workspace dependencies and the lockfile', () => {
    useInputs({
      'working-directory': 'apps/ext',
      upload: 'false',
      'github-token': 'token',
      'ignore-workspace-packages': '@internal/api\n@internal/eslint-config',
    });

    expect(readInputs()).toMatchObject({
      workingDirectory: 'apps/ext',
      paths: [],
      workspaceDependencies: true,
      ignoreWorkspacePackages: ['@internal/api', '@internal/eslint-config'],
      dependencyUpdates: true,
      branches: ['main'],
      tagFormat: 'v${version}',
      store: undefined,
      submit: true,
      commit: true,
      commitMessage: DEFAULT_COMMIT_MESSAGE,
      githubRelease: true,
      dryRun: false,
    });
  });

  it('reads store credentials and masks the secrets', () => {
    useInputs({
      ...storeInputs,
      upload: 'true',
      package: 'build',
      'github-token': 'token',
    });

    expect(readInputs().store).toEqual({
      extensionId: 'ext-id',
      publisherId: 'pub-id',
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
    });
    expect(core.setSecret).toHaveBeenCalledWith('secret');
    expect(core.setSecret).toHaveBeenCalledWith('refresh');
  });

  it('reports every missing store input at once', () => {
    useInputs({
      upload: 'true',
      package: 'build',
      'extension-id': 'ext-id',
      'github-token': 't',
    });

    expect(() => readInputs()).toThrow(
      'needs these inputs: publisher-id, client-id, client-secret, refresh-token',
    );
  });

  it('requires a package when uploading', () => {
    useInputs({ ...storeInputs, upload: 'true', 'github-token': 'token' });

    expect(() => readInputs()).toThrow('"package" input is required');
  });
});
