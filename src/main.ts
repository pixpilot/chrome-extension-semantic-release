import * as core from '@actions/core';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

interface NextRelease {
  version: string;
  notes: string;
}

interface SemanticReleaseResult {
  nextRelease: NextRelease;
}

type SemanticRelease = (
  options: {
    ci: boolean;
  },
  context: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdout: NodeJS.WriteStream;
    stderr: NodeJS.WriteStream;
  },
) => Promise<SemanticReleaseResult | false>;

async function runSemanticReleaseIfEnabled(enabled: boolean): Promise<SemanticReleaseResult | false> {
  if (!enabled) {
    core.info('Skipping semantic-release because run-semantic-release is false.');
    return false;
  }

  const semanticReleaseModule = await import('semantic-release');
  const semanticRelease = semanticReleaseModule.default as SemanticRelease;

  return semanticRelease(
    { ci: true },
    {
      cwd: process.cwd(),
      env: process.env,
      stdout: process.stdout,
      stderr: process.stderr,
    },
  );
}

async function updateManifestVersion(manifestPath: string, version: string): Promise<void> {
  const manifestContent = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent) as Record<string, unknown>;
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(command, args, { cwd }, (error, _stdout, stderr) => {
      if (error) {
        const errorMessage = stderr || error.message;
        rejectPromise(new Error(`${command} failed: ${errorMessage}`));
        return;
      }

      resolvePromise();
    });
  });
}

async function packageExtension(extensionDirectory: string, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const relativeOutputPath = relative(extensionDirectory, outputPath);
  const zipArgs = ['-r', outputPath, '.'];

  if (!relativeOutputPath.startsWith('..')) {
    zipArgs.push('-x', relativeOutputPath);
  }

  await runCommand('zip', zipArgs, extensionDirectory);
}

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to create access token: ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Failed to create access token: access_token missing in response');
  }

  return data.access_token;
}

async function publishExtension(
  extensionId: string,
  target: string,
  packagePath: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<void> {
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  const packageBuffer = await readFile(packagePath);
  const authorizationValue = ['Bearer', accessToken].join(' ');

  const uploadResponse = await fetch(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: authorizationValue,
        'Content-Type': 'application/zip',
      },
      body: packageBuffer,
    },
  );

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload extension package: ${await uploadResponse.text()}`);
  }

  const publishResponse = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=${encodeURIComponent(target)}`,
    {
      method: 'POST',
      headers: {
        Authorization: authorizationValue,
      },
    },
  );

  if (!publishResponse.ok) {
    throw new Error(`Failed to publish extension: ${await publishResponse.text()}`);
  }
}

/**
 * The main function for the action.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const extensionDirectory = resolve(core.getInput('extension-directory') || '.');
    const manifestPath = resolve(extensionDirectory, core.getInput('manifest-path') || 'manifest.json');
    const packagePath = resolve(core.getInput('package-path') || 'release/chrome-extension.zip');

    const semanticReleaseEnabled = core.getBooleanInput('run-semantic-release');
    const publishEnabled = core.getBooleanInput('publish');

    let version = core.getInput('release-version');
    let releaseNotes = core.getInput('release-notes');
    let released = false;

    const semanticReleaseResult = await runSemanticReleaseIfEnabled(semanticReleaseEnabled);
    if (semanticReleaseResult) {
      released = true;
      version = semanticReleaseResult.nextRelease.version;
      releaseNotes = semanticReleaseResult.nextRelease.notes;
      core.info(`Semantic release published version ${version}.`);
    }

    if (!version) {
      core.info('No release version available. Skipping packaging and publishing.');
      core.setOutput('released', String(released));
      core.setOutput('published', 'false');
      return;
    }

    await updateManifestVersion(manifestPath, version);
    await packageExtension(extensionDirectory, packagePath);

    let published = false;
    if (publishEnabled) {
      const extensionId = core.getInput('chrome-extension-id');
      const clientId = core.getInput('chrome-client-id');
      const clientSecret = core.getInput('chrome-client-secret');
      const refreshToken = core.getInput('chrome-refresh-token');
      const publishTarget = core.getInput('chrome-publish-target') || 'default';

      if (!extensionId || !clientId || !clientSecret || !refreshToken) {
        throw new Error(
          'chrome-extension-id, chrome-client-id, chrome-client-secret and chrome-refresh-token are required when publish is true.',
        );
      }

      await publishExtension(
        extensionId,
        publishTarget,
        packagePath,
        clientId,
        clientSecret,
        refreshToken,
      );
      published = true;
    } else {
      core.info('Skipping Chrome Web Store publish because publish is false.');
    }

    core.setOutput('released', String(released));
    core.setOutput('version', version);
    core.setOutput('release-notes', releaseNotes);
    core.setOutput('package-path', packagePath);
    core.setOutput('published', String(published));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(errorMessage);
  }
}
