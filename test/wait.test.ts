import { afterEach, describe, expect, it, vi } from 'vitest';
import { wait } from '../src/wait';

describe('wait.ts', () => {
  afterEach(() => {
    // Restore real timers after tests that use fake timers
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves after the given milliseconds', async () => {
    vi.useFakeTimers();

    const promise = wait(500);

    // Fast-forward timers
    vi.advanceTimersByTime(500);

    const result = await promise;
    expect(result).toBe('done!');
  });

  it('rejects when milliseconds is not a number', async () => {
    await expect(wait(Number.NaN)).rejects.toThrow('milliseconds is not a number');
  });
});
