import process from 'node:process';
import { describe, expect, it } from 'vitest';

import { executeCommand, executeShell } from '../src/commands';

const cwd = process.cwd();

describe('executeCommand', () => {
  it('resolves with standard output', async () => {
    await expect(
      executeCommand(process.execPath, ['-e', 'process.stdout.write("ok")'], cwd),
    ).resolves.toBe('ok');
  });

  it('rejects with standard error', async () => {
    await expect(
      executeCommand(
        process.execPath,
        ['-e', 'console.error("broken"); process.exit(2)'],
        cwd,
      ),
    ).rejects.toThrow('broken');
  });
});

describe('executeShell', () => {
  it('resolves when the command succeeds and rejects with its exit code', async () => {
    await expect(executeShell('node -e "0"', cwd)).resolves.toBeUndefined();
    await expect(executeShell('node -e "process.exit(3)"', cwd)).rejects.toThrow(
      'exited with code 3',
    );
  });
});
