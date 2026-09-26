import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readVersion, writeVersion } from '../src/version-files';

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'version-files-'));
  file = path.join(directory, 'package.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('writeVersion', () => {
  it('changes only the version, keeping indentation and the trailing newline', async () => {
    await writeFile(
      file,
      '{\n    "name": "ext",\n    "version": "1.0.0",\n    "private": true\n}\n',
    );

    await writeVersion(file, '1.1.0');

    await expect(readFile(file, 'utf8')).resolves.toBe(
      '{\n    "name": "ext",\n    "version": "1.1.0",\n    "private": true\n}\n',
    );
  });

  it('keeps tab indentation and CRLF line endings', async () => {
    await writeFile(file, '{\r\n\t"version": "1.0.0"\r\n}');

    await writeVersion(file, '2.0.0');

    await expect(readFile(file, 'utf8')).resolves.toBe('{\r\n\t"version": "2.0.0"\r\n}');
  });
});

describe('readVersion', () => {
  it('reads the version', async () => {
    await writeFile(file, '{"version": "3.2.1"}');
    await expect(readVersion(file)).resolves.toBe('3.2.1');
  });

  it('explains a missing file, a missing version and a non-object', async () => {
    await expect(readVersion(file)).rejects.toThrow('does not exist');

    await writeFile(file, '{"name": "ext"}');
    await expect(readVersion(file)).rejects.toThrow('has no "version" field');

    await writeFile(file, '[]');
    await expect(readVersion(file)).rejects.toThrow('does not contain a JSON object');
  });
});
