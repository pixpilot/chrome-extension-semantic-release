import type { ReleaseOutcome } from './release';
import * as core from '@actions/core';

import { readInputs } from './inputs';
import { release } from './release';

const SUMMARY_HEADING_LEVEL = 3;

/**
 * Releases the extension when its commits call for a new version, and
 * publishes the result as GitHub Actions outputs and a step summary.
 */
export async function run(): Promise<void> {
  try {
    const inputs = readInputs();
    const outcome = await release(inputs);

    core.setOutput('released', String(outcome.released));
    core.setOutput('version', outcome.version);
    core.setOutput('previous-version', outcome.previousVersion);
    core.setOutput('tag', outcome.tag);
    core.setOutput('release-type', outcome.type);
    core.setOutput('notes', outcome.notes);
    core.setOutput('package-path', outcome.packagePath);

    // The release has happened by now; a summary that cannot be written must
    // not report it as failed.
    await writeSummary(outcome, inputs.dryRun).catch((error: unknown) => {
      core.warning(`Could not write the step summary: ${describeError(error)}`);
    });
  } catch (error) {
    core.setFailed(describeError(error));
  }
}

// semantic-release throws an AggregateError whose message is every inner error's
// stack trace; the inner messages are what the reader needs.
function describeError(error: unknown): string {
  if (error instanceof Error && 'errors' in error && Array.isArray(error.errors)) {
    return error.errors.map(describeError).join('\n');
  }

  return error instanceof Error ? error.message : String(error);
}

async function writeSummary(outcome: ReleaseOutcome, dryRun: boolean): Promise<void> {
  if (!outcome.version) {
    core.info('No release: no relevant commits since the last release.');
    await core.summary
      .addHeading('No extension release', SUMMARY_HEADING_LEVEL)
      .addRaw('No commits since the last release call for a new version.')
      .write();
    return;
  }

  const heading = dryRun
    ? `Dry run: would release ${outcome.tag}`
    : `Released ${outcome.tag}`;

  core.info(
    `${heading} (${outcome.type}, previous ${outcome.previousVersion || 'none'})`,
  );
  await core.summary
    .addHeading(heading, SUMMARY_HEADING_LEVEL)
    .addRaw(outcome.notes)
    .write();
}
