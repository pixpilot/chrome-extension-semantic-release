/* eslint-disable no-template-curly-in-string -- semantic-release tag templates */
import type { ChromeWebStore } from '../src/chrome-web-store';
import type { CommandRunner, ShellRunner } from '../src/commands';
import type { ExtensionPluginOptions } from '../src/plugins/extension';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExtensionPlugin } from '../src/plugins/extension';

let root: string;
let extension: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'extension-plugin-'));
  extension = path.join(root, 'apps', 'ext');
  await mkdir(extension, { recursive: true });
  await writeFile(path.join(extension, 'package.json'), '{\n  "version": "2.0.0"\n}\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function createStore(overrides: Partial<ChromeWebStore> = {}): ChromeWebStore {
  return {
    itemUrl: 'https://chromewebstore.google.com/detail/ext-id',
    verify: vi.fn(async () => {}),
    hasPendingReview: vi.fn(async () => false),
    cancelPendingSubmission: vi.fn(async () => true),
    upload: vi.fn(async () => {}),
    submit: vi.fn(async () => 'PENDING_REVIEW'),
    ...overrides,
  };
}

// The build writes the unpacked extension, reading its version like crxjs does.
const buildFromPackageJson: ShellRunner = async (_command, cwd) => {
  const { version } = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  await mkdir(path.join(cwd, 'build'), { recursive: true });
  await writeFile(path.join(cwd, 'build', 'manifest.json'), JSON.stringify({ version }));
};

function setup(overrides: Partial<ExtensionPluginOptions> = {}) {
  const options: ExtensionPluginOptions = {
    run: vi.fn<CommandRunner>(async () => 'abc123\n'),
    runShell: vi.fn(buildFromPackageJson),
    repositoryRoot: root,
    workingDirectory: extension,
    packageJson: path.join(extension, 'package.json'),
    manifest: undefined,
    buildCommand: 'pnpm run build',
    packagePath: path.join(extension, 'build'),
    store: createStore(),
    submit: true,
    tagFormat: 'ext-v${version}',
    ...overrides,
  };
  return { options, ...createExtensionPlugin(options) };
}

const logger = { log: vi.fn(), success: vi.fn() };
const nextRelease = { version: '2.1.0', gitTag: 'ext-v2.1.0' };

describe('verifyConditions', () => {
  it('checks the version files and the store credentials', async () => {
    const { plugin, options } = setup();

    await plugin.verifyConditions({}, { logger } as never);

    expect(options.store?.verify).toHaveBeenCalled();
  });

  it('fails when package.json has no version', async () => {
    await writeFile(path.join(extension, 'package.json'), '{}');
    const { plugin } = setup();

    await expect(plugin.verifyConditions({}, { logger } as never)).rejects.toThrow(
      'has no "version" field',
    );
  });
});

describe('verifyRelease', () => {
  it('explains how to add the missing baseline tag', async () => {
    const { plugin } = setup();

    await expect(
      plugin.verifyRelease({}, {
        lastRelease: {},
        nextRelease: { version: '1.0.0' },
      } as never),
    ).rejects.toThrow(
      /1\.0\.0 is lower than 2\.0\.0 in apps\/ext\/package\.json: no tag matches[\s\S]*git tag ext-v2\.0\.0 abc123/u,
    );
  });

  it('allows a version at or above package.json', async () => {
    const { plugin } = setup();

    await expect(
      plugin.verifyRelease({}, {
        lastRelease: {},
        nextRelease: { version: '2.0.0' },
      } as never),
    ).resolves.toBeUndefined();
  });
});

describe('prepare', () => {
  it('bumps, builds and uploads the unpacked build', async () => {
    const manifest = path.join(extension, 'manifest.json');
    await writeFile(manifest, '{\n  "version": "2.0.0"\n}\n');
    const { plugin, options, getPackagePath } = setup({ manifest });

    await plugin.prepare({}, { logger, nextRelease } as never);

    await expect(readFile(options.packageJson, 'utf8')).resolves.toContain(
      '"version": "2.1.0"',
    );
    await expect(readFile(manifest, 'utf8')).resolves.toContain('"version": "2.1.0"');
    expect(options.runShell).toHaveBeenCalledWith('pnpm run build', extension);
    expect(options.store?.upload).toHaveBeenCalledWith(options.packagePath);
    expect(options.store?.cancelPendingSubmission).not.toHaveBeenCalled();
    expect(getPackagePath()).toBe(options.packagePath);
  });

  it('cancels a pending review before uploading the new package', async () => {
    const calls: string[] = [];
    const { plugin, wasReviewCancelled } = setup({
      store: createStore({
        hasPendingReview: vi.fn(async () => {
          calls.push('status');
          return true;
        }),
        cancelPendingSubmission: vi.fn(async () => {
          calls.push('cancel');
          return true;
        }),
        upload: vi.fn(async () => {
          calls.push('upload');
        }),
        submit: vi.fn(async () => {
          calls.push('submit');
          return 'PENDING_REVIEW';
        }),
      }),
    });

    await plugin.prepare({}, { logger, nextRelease } as never);
    await plugin.publish({}, { logger, nextRelease } as never);

    expect(calls).toEqual(['status', 'cancel', 'upload', 'submit']);
    expect(wasReviewCancelled()).toBe(true);
    expect(logger.log).toHaveBeenCalledWith(
      'Existing Chrome Web Store submission is pending review',
    );
  });

  it('stops before upload when cancellation fails', async () => {
    const store = createStore({
      hasPendingReview: vi.fn(async () => true),
      cancelPendingSubmission: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
    });
    const { plugin } = setup({ store });

    await expect(plugin.prepare({}, { logger, nextRelease } as never)).rejects.toThrow(
      'quota exceeded',
    );
    expect(store.upload).not.toHaveBeenCalled();
  });

  it('uploads the single zip in a package folder', async () => {
    const zipFolder = path.join(extension, 'package');
    const { plugin, options } = setup({
      packagePath: zipFolder,
      runShell: vi.fn(async () => {
        await mkdir(zipFolder);
        await writeFile(path.join(zipFolder, 'ext-2.1.0.zip'), 'zip');
      }),
    });

    await plugin.prepare({}, { logger, nextRelease } as never);

    expect(options.store?.upload).toHaveBeenCalledWith(
      path.join(zipFolder, 'ext-2.1.0.zip'),
    );
  });

  it('refuses a build that did not pick up the new version', async () => {
    const { plugin, options } = setup({
      runShell: vi.fn(async (_command: string, cwd: string) => {
        await mkdir(path.join(cwd, 'build'));
        await writeFile(path.join(cwd, 'build', 'manifest.json'), '{"version": "2.0.0"}');
      }),
    });

    await expect(plugin.prepare({}, { logger, nextRelease } as never)).rejects.toThrow(
      'has version 2.0.0, expected 2.1.0',
    );
    expect(options.store?.upload).not.toHaveBeenCalled();
  });

  it('refuses a missing package and an ambiguous package folder', async () => {
    const empty = setup({ runShell: vi.fn(async () => {}) });
    await expect(
      empty.plugin.prepare({}, { logger, nextRelease } as never),
    ).rejects.toThrow('does not exist after the build');

    const folder = path.join(extension, 'package');
    await mkdir(folder);
    await writeFile(path.join(folder, 'a.zip'), '');
    await writeFile(path.join(folder, 'b.zip'), '');
    const ambiguous = setup({ packagePath: folder, runShell: vi.fn(async () => {}) });
    await expect(
      ambiguous.plugin.prepare({}, { logger, nextRelease } as never),
    ).rejects.toThrow('Expected exactly one .zip');
  });

  it('only bumps the version without a build command, package or store', async () => {
    const { plugin, options } = setup({
      buildCommand: '',
      packagePath: '',
      store: undefined,
    });

    await plugin.prepare({}, { logger, nextRelease } as never);

    expect(options.runShell).not.toHaveBeenCalled();
    await expect(readFile(options.packageJson, 'utf8')).resolves.toContain('2.1.0');
  });
});

describe('publish', () => {
  it('submits the upload for review', async () => {
    const { plugin, options } = setup();

    await expect(plugin.publish({}, { logger, nextRelease } as never)).resolves.toEqual({
      name: 'Chrome Web Store',
      url: 'https://chromewebstore.google.com/detail/ext-id',
    });
    expect(options.store?.submit).toHaveBeenCalled();
  });

  it('leaves a draft when submit is off, and does nothing without a store', async () => {
    const draft = setup({ submit: false });
    await expect(
      draft.plugin.publish({}, { logger, nextRelease } as never),
    ).resolves.toMatchObject({
      name: 'Chrome Web Store draft',
    });
    expect(draft.options.store?.submit).not.toHaveBeenCalled();

    const none = setup({ store: undefined });
    await expect(none.plugin.publish({}, { logger, nextRelease } as never)).resolves.toBe(
      false,
    );
  });

  it('says the draft is uploaded when submission fails', async () => {
    const { plugin } = setup({
      store: createStore({
        submit: vi.fn(async () => {
          throw new Error('Item is pending review');
        }),
      }),
    });

    await expect(plugin.publish({}, { logger, nextRelease } as never)).rejects.toThrow(
      /2\.1\.0 was uploaded, but submitting it for review failed: Item is pending review/u,
    );
  });
});
