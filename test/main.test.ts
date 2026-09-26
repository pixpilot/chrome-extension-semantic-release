import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const waitMock = vi.fn();

// Mock @actions/core - vitest will use __mocks__/@actions/core.ts
vi.mock('@actions/core');
vi.mock('../src/wait', () => ({ wait: waitMock }));

const { run } = await import('../src/main');

describe('main.ts', () => {
  beforeEach(() => {
    vi.mocked(core.getInput).mockImplementation(() => '500');
    vi.mocked(waitMock).mockResolvedValue('done!');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('__mocks__/core.ts verification', () => {
    it('should have core functions mocked from __mocks__/core.ts', () => {
      // Verify that core functions are actually mocked functions
      expect(vi.isMockFunction(core.debug)).toBe(true);
      expect(vi.isMockFunction(core.error)).toBe(true);
      expect(vi.isMockFunction(core.info)).toBe(true);
      expect(vi.isMockFunction(core.getInput)).toBe(true);
      expect(vi.isMockFunction(core.setOutput)).toBe(true);
      expect(vi.isMockFunction(core.setFailed)).toBe(true);
      expect(vi.isMockFunction(core.warning)).toBe(true);
    });

    it('should allow mocking of core functions', () => {
      // Test that we can mock and call core functions
      vi.mocked(core.debug).mockImplementation((message: string) => {
        console.log(`DEBUG: ${message}`);
      });

      core.debug('test message');
      expect(vi.mocked(core.debug)).toHaveBeenCalledWith('test message');
    });
  });

  it('sets the time output', async () => {
    await run();

    expect(vi.mocked(core.setOutput)).toHaveBeenNthCalledWith(
      1,
      'time',
      // Match HH:MM:SS
      expect.stringMatching(/^\d{2}:\d{2}:\d{2}/u),
    );
  });

  it('calls core.info and core.debug functions during execution', async () => {
    await run();

    // Verify info calls
    expect(vi.mocked(core.info)).toHaveBeenCalledWith(
      'Starting GitHub Action with 500 milliseconds wait time',
    );
    expect(vi.mocked(core.info)).toHaveBeenCalledWith(
      'GitHub Action completed successfully',
    );

    // Verify debug calls
    expect(vi.mocked(core.debug)).toHaveBeenCalledWith('Waiting 500 milliseconds ...');
    // Debug should be called 3 times (waiting message + 2 timestamps)
    expect(vi.mocked(core.debug)).toHaveBeenCalledTimes(3);
  });

  it('sets a failed status', async () => {
    vi.mocked(core.getInput).mockClear().mockReturnValueOnce('this is not a number');

    vi.mocked(waitMock)
      .mockClear()
      .mockRejectedValueOnce(new Error('milliseconds is not a number'));

    await run();

    // Verify error logging
    expect(vi.mocked(core.error)).toHaveBeenCalledWith(
      'Action failed: milliseconds is not a number',
    );

    // Verify setFailed is called
    expect(vi.mocked(core.setFailed)).toHaveBeenNthCalledWith(
      1,
      'milliseconds is not a number',
    );
  });

  it('logs and handles non-Error failures without setting failed status', async () => {
    vi.mocked(core.getInput).mockClear().mockReturnValueOnce('500');

    vi.mocked(waitMock).mockClear().mockRejectedValueOnce('unexpected failure');

    await run();

    expect(vi.mocked(core.error)).toHaveBeenCalledWith(
      'Action failed: unexpected failure',
    );
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });
});
