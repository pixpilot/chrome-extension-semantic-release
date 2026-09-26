import { execFile, spawn } from 'node:child_process';

/** Executes a command without a shell and resolves with its standard output. */
export type CommandRunner = (
  command: string,
  arguments_: readonly string[],
  cwd: string,
) => Promise<string>;

/** Executes a caller-supplied shell command, streaming its output to the log. */
export type ShellRunner = (command: string, cwd: string) => Promise<void>;

// Large enough for `git log` over a long history.
// eslint-disable-next-line no-magic-numbers -- 64 MiB
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export const executeCommand: CommandRunner = async (command, arguments_, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      arguments_,
      { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${command} ${arguments_.join(' ')} failed: ${stderr || error.message}`,
            ),
          );
          return;
        }

        resolve(stdout);
      },
    );
  });

export const executeShell: ShellRunner = async (command, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: 'inherit' });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Build command "${command}" exited with code ${code}.`));
    });
  });
