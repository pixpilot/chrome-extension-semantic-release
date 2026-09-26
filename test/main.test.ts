import * as core from '@actions/core';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const semanticReleaseMock = vi.fn();

vi.mock('@actions/core');
vi.mock('semantic-release', () => ({ default: semanticReleaseMock }));
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const { run } = await import('../src/main');

describe('main.ts', () => {
  beforeEach(() => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const defaults: Record<string, string> = {
        'extension-directory': '.',
        'manifest-path': 'manifest.json',
        'package-path': 'release/chrome-extension.zip',
        'release-version': '',
        'release-notes': '',
        'chrome-extension-id': '',
        'chrome-client-id': '',
        'chrome-client-secret': '',
        'chrome-refresh-token': '',
        'chrome-publish-target': 'default',
      };

      return defaults[name] ?? '';
    });

    vi.mocked(core.getBooleanInput).mockImplementation((name: string) => {
      const defaults: Record<string, boolean> = {
        'run-semantic-release': true,
        publish: false,
      };

      return defaults[name] ?? false;
    });

    vi.mocked(execFile).mockImplementation(
      (_command, _args, _options, callback: (error: Error | null) => void) => {
        callback(null);
        return {} as ReturnType<typeof execFile>;
      },
    );

    vi.mocked(fs.readFile).mockImplementation(async (path: fs.PathLike) => {
      if (String(path).endsWith('.zip')) {
        return Buffer.from('zip-content');
      }

      return '{"name":"extension","version":"0.0.0"}';
    });
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    semanticReleaseMock.mockResolvedValue(false);

    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('skips packaging and publishing when there is no release version', async () => {
    await run();

    expect(vi.mocked(core.info)).toHaveBeenCalledWith(
      'No release version available. Skipping packaging and publishing.',
    );
    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('released', 'false');
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('published', 'false');
  });

  it('updates manifest and packages extension when semantic-release returns a new release', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: {
        version: '1.2.3',
        notes: 'release notes',
      },
    });

    await run();

    expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
      expect.stringContaining('manifest.json'),
      expect.stringContaining('"version": "1.2.3"'),
      'utf8',
    );
    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      'zip',
      expect.arrayContaining(['-r']),
      expect.objectContaining({ cwd: expect.any(String) }),
      expect.any(Function),
    );
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('released', 'true');
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('version', '1.2.3');
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('release-notes', 'release notes');
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('published', 'false');
  });

  it('fails when publish is enabled without credentials', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: {
        version: '1.2.3',
        notes: 'release notes',
      },
    });

    vi.mocked(core.getBooleanInput).mockImplementation((name: string) => {
      const defaults: Record<string, boolean> = {
        'run-semantic-release': true,
        publish: true,
      };
      return defaults[name] ?? false;
    });

    await run();

    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith(
      'chrome-extension-id, chrome-client-id, chrome-client-secret and chrome-refresh-token are required when publish is true.',
    );
  });

  it('publishes extension when publish is enabled with credentials', async () => {
    semanticReleaseMock.mockResolvedValue({
      nextRelease: {
        version: '1.2.3',
        notes: 'release notes',
      },
    });

    vi.mocked(core.getBooleanInput).mockImplementation((name: string) => {
      const defaults: Record<string, boolean> = {
        'run-semantic-release': true,
        publish: true,
      };
      return defaults[name] ?? false;
    });

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const defaults: Record<string, string> = {
        'extension-directory': '.',
        'manifest-path': 'manifest.json',
        'package-path': 'release/chrome-extension.zip',
        'release-version': '',
        'release-notes': '',
        'chrome-extension-id': 'abc123',
        'chrome-client-id': 'client-id',
        'chrome-client-secret': 'client-secret',
        'chrome-refresh-token': 'refresh-token',
        'chrome-publish-target': 'default',
      };

      return defaults[name] ?? '';
    });

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
        text: async () => '',
      } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as Response);

    await run();

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('published', 'true');
  });
});
