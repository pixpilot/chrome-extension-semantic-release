import { readFile, writeFile } from 'node:fs/promises';

/** Reads the top-level `version` of a JSON file such as package.json or manifest.json. */
export async function readVersion(file: string): Promise<string> {
  const { data } = await readJson(file);

  if (typeof data.version !== 'string' || !data.version) {
    throw new Error(`${file} has no "version" field.`);
  }

  return data.version;
}

/**
 * Sets the top-level `version` of a JSON file, keeping key order, indentation,
 * line endings and the trailing newline so the release commit only changes
 * that one line.
 */
export async function writeVersion(file: string, version: string): Promise<void> {
  const { data, text } = await readJson(file);
  const indent = /^[ \t]+(?=")/mu.exec(text)?.[0] ?? '  ';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = /\r?\n$/u.test(text) ? eol : '';
  const json = JSON.stringify({ ...data, version }, null, indent).replaceAll('\n', eol);

  await writeFile(file, `${json}${trailingNewline}`);
}

async function readJson(
  file: string,
): Promise<{ data: Record<string, unknown>; text: string }> {
  let text: string;

  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`${file} does not exist.`);
  }

  const data: unknown = JSON.parse(text);

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${file} does not contain a JSON object.`);
  }

  return { data: data as Record<string, unknown>, text };
}
