import type {
  PrepareContext,
  PublishContext,
  VerifyConditionsContext,
  VerifyReleaseContext,
} from 'semantic-release';
import type { ChromeWebStore } from '../chrome-web-store';
import type { CommandRunner, ShellRunner } from '../commands';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';

import { findVersionCommit, toRepositoryPath } from '../repository';
import { readVersion, writeVersion } from '../version-files';
import { namedPlugin } from './named-plugin';

export interface ExtensionPluginOptions {
  readonly run: CommandRunner;
  readonly runShell: ShellRunner;
  readonly repositoryRoot: string;
  readonly workingDirectory: string;
  /** Absolute path of the package.json whose version is released. */
  readonly packageJson: string;
  /** Absolute path of a source manifest.json to bump as well, if the build does not derive it. */
  readonly manifest: string | undefined;
  readonly buildCommand: string;
  /** Absolute path of the built .zip, a folder holding one, or the unpacked build. */
  readonly packagePath: string;
  /** Absent when the release should not touch the Chrome Web Store. */
  readonly store: ChromeWebStore | undefined;
  readonly submit: boolean;
  readonly tagFormat: string;
}

export interface ExtensionPlugin {
  readonly plugin: ReturnType<typeof namedPlugin>;
  /** The package prepared for this release, once `prepare` has run. */
  readonly getPackagePath: () => string | undefined;
}

/**
 * Versions, builds and ships the extension. The store upload happens in
 * `prepare`, before the release commit and tag, so a rejected package leaves the
 * branch untouched and the next run retries the same version. Only submission
 * for review waits for `publish`.
 */
export function createExtensionPlugin(options: ExtensionPluginOptions): ExtensionPlugin {
  const { repositoryRoot, packageJson, store } = options;
  const versionFiles =
    options.manifest === undefined ? [packageJson] : [packageJson, options.manifest];
  const display = (file: string): string =>
    toRepositoryPath(repositoryRoot, repositoryRoot, file);
  let packagePath: string | undefined;

  const plugin = namedPlugin('chrome extension', {
    async verifyConditions(_pluginConfig: object, { logger }: VerifyConditionsContext) {
      await Promise.all(versionFiles.map(readVersion));

      if (store) {
        await store.verify();
        logger.log('Chrome Web Store credentials verified');
      }
    },

    async verifyRelease(
      _pluginConfig: object,
      { lastRelease, nextRelease }: VerifyReleaseContext,
    ) {
      const current = await readVersion(packageJson);

      if (semver.lt(nextRelease.version, current)) {
        throw await createBaselineError(
          options,
          current,
          nextRelease.version,
          lastRelease.gitTag,
        );
      }
    },

    async prepare(_pluginConfig: object, { logger, nextRelease }: PrepareContext) {
      await Promise.all(
        versionFiles.map(async (file) => writeVersion(file, nextRelease.version)),
      );
      logger.log(
        'Set version %s in %s',
        nextRelease.version,
        versionFiles.map(display).join(', '),
      );

      if (options.buildCommand) {
        logger.log('Running %s', options.buildCommand);
        await options.runShell(options.buildCommand, options.workingDirectory);
      }

      if (!options.packagePath) return;

      packagePath = await resolvePackage(
        options.packagePath,
        nextRelease.version,
        display,
      );

      if (store) {
        logger.log('Uploading %s to the Chrome Web Store', display(packagePath));
        await store.upload(packagePath);
        logger.success('Uploaded version %s as a draft', nextRelease.version);
      }
    },

    async publish(_pluginConfig: object, { logger, nextRelease }: PublishContext) {
      if (!store) return false;

      if (!options.submit) {
        logger.log(
          'Left version %s as a draft; submit it from the developer dashboard',
          nextRelease.version,
        );
        return { name: 'Chrome Web Store draft', url: store.itemUrl };
      }

      try {
        const state = await store.submit();
        logger.success(
          'Submitted version %s for review (%s)',
          nextRelease.version,
          state,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Version ${nextRelease.version} was uploaded, but submitting it for review failed: ${reason}. Submit the draft from the developer dashboard; re-running will not retry because ${nextRelease.gitTag} is already tagged.`,
        );
      }

      return { name: 'Chrome Web Store', url: store.itemUrl };
    },
  });

  return { plugin, getPackagePath: () => packagePath };
}

async function resolvePackage(
  target: string,
  version: string,
  display: (file: string) => string,
): Promise<string> {
  const stats = await stat(target).catch(() => undefined);

  if (!stats) {
    throw new Error(
      `${display(target)} does not exist after the build. Check the "package" and "build-command" inputs.`,
    );
  }

  if (stats.isFile()) return target;

  const entries = await readdir(target);

  if (entries.includes('manifest.json')) {
    const built = await readVersion(path.join(target, 'manifest.json'));

    if (built !== version) {
      throw new Error(
        `${display(target)}/manifest.json has version ${built}, expected ${version}. The build must take its version from the files this action bumps.`,
      );
    }

    return target;
  }

  const zips = entries.filter((entry) => entry.endsWith('.zip'));

  if (zips.length !== 1) {
    throw new Error(
      `Expected exactly one .zip in ${display(target)}, found ${zips.length}.`,
    );
  }

  return path.join(target, zips[0]);
}

async function createBaselineError(
  { run, repositoryRoot, packageJson, tagFormat }: ExtensionPluginOptions,
  current: string,
  next: string,
  lastTag: string | undefined,
): Promise<Error> {
  const file = toRepositoryPath(repositoryRoot, repositoryRoot, packageJson);
  // eslint-disable-next-line no-template-curly-in-string -- the tag-format placeholder
  const tag = tagFormat.replace('${version}', current);
  const commit =
    (await findVersionCommit(run, repositoryRoot, file)) ??
    `<commit that shipped ${current}>`;
  const cause =
    lastTag === undefined
      ? `no tag matches "${tagFormat}", so semantic-release started from scratch`
      : `${file} is ahead of the last release tag ${lastTag}`;

  return new Error(
    `The next version ${next} is lower than ${current} in ${file}: ${cause}. The Chrome Web Store only accepts higher versions. Tag the commit that shipped ${current} once, then re-run:\n\n  git tag ${tag} ${commit}\n  git push origin ${tag}\n`,
  );
}
