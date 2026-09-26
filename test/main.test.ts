import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readInputs } from '../src/inputs';
import { run } from '../src/main';
import { release } from '../src/release';

vi.mock('@actions/core');
vi.mock('../src/inputs', () => ({ readInputs: vi.fn() }));
vi.mock('../src/release', () => ({ release: vi.fn() }));

const outcome = {
  released: true,
  version: '2.1.0',
  previousVersion: '2.0.0',
  tag: 'ext-v2.1.0',
  type: 'minor',
  notes: '## 2.1.0',
  packagePath: 'apps/ext/package/ext-2.1.0.zip',
};

describe('run', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sets every output and summarises the release', async () => {
    vi.mocked(readInputs).mockReturnValue({ dryRun: false } as never);
    vi.mocked(release).mockResolvedValue(outcome);

    await run();

    expect(vi.mocked(core.setOutput).mock.calls).toEqual([
      ['released', 'true'],
      ['version', '2.1.0'],
      ['previous-version', '2.0.0'],
      ['tag', 'ext-v2.1.0'],
      ['release-type', 'minor'],
      ['notes', '## 2.1.0'],
      ['package-path', 'apps/ext/package/ext-2.1.0.zip'],
    ]);
    expect(core.summary.addHeading).toHaveBeenCalledWith('Released ext-v2.1.0', 3);
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('summarises a dry run and a run without a release', async () => {
    vi.mocked(readInputs).mockReturnValue({ dryRun: true } as never);
    vi.mocked(release).mockResolvedValueOnce({ ...outcome, released: false });
    await run();
    expect(core.summary.addHeading).toHaveBeenCalledWith(
      'Dry run: would release ext-v2.1.0',
      3,
    );

    vi.mocked(release).mockResolvedValueOnce({
      ...outcome,
      released: false,
      version: '',
      tag: '',
    });
    await run();
    expect(core.summary.addHeading).toHaveBeenCalledWith('No extension release', 3);
  });

  it('fails with the inner messages of a semantic-release AggregateError', async () => {
    vi.mocked(readInputs).mockReturnValue({ dryRun: false } as never);
    vi.mocked(release).mockRejectedValue(
      new AggregateError(
        [new Error('first problem'), new Error('second problem')],
        'stack dump',
      ),
    );

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('first problem\nsecond problem');
  });

  it('only warns when the summary cannot be written after a release', async () => {
    vi.mocked(readInputs).mockReturnValue({ dryRun: false } as never);
    vi.mocked(release).mockResolvedValue(outcome);
    vi.mocked(core.summary.write).mockRejectedValueOnce(new Error('no summary file'));

    await run();

    expect(core.warning).toHaveBeenCalledWith(
      'Could not write the step summary: no summary file',
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails when the inputs are invalid', async () => {
    vi.mocked(readInputs).mockImplementation(() => {
      throw new Error('The "package" input is required');
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('The "package" input is required');
    expect(release).not.toHaveBeenCalled();
  });
});
