import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectWorkspaceFolders,
  findWorkspacePackages,
  findWorkspaceRoot,
} from '../src/workspace';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'workspace-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writePackage(
  folder: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  await mkdir(path.join(root, folder), { recursive: true });
  await writeFile(path.join(root, folder, 'package.json'), JSON.stringify(manifest));
}

// apps/ext bundles ui (and through it utils) plus html, which it lists as a
// devDependency. It imports the api server for types only, and api is the only
// way to reach users.
async function writeMonorepo(): Promise<void> {
  await writePackage('apps/ext', {
    name: 'ext',
    dependencies: { ui: 'workspace:*', react: '^19.0.0' },
    devDependencies: { html: 'workspace:*', api: 'workspace:*', config: 'workspace:*' },
  });
  await writePackage('apps/web', { name: 'web', dependencies: { ui: 'workspace:*' } });
  await writePackage('packages/ui', {
    name: 'ui',
    dependencies: { utils: 'workspace:*' },
  });
  await writePackage('packages/utils', {
    name: 'utils',
    dependencies: { ui: 'workspace:*' },
  });
  await writePackage('packages/html', { name: 'html' });
  await writePackage('packages/api', {
    name: 'api',
    dependencies: { users: 'workspace:*' },
  });
  await writePackage('packages/users', { name: 'users' });
  await writePackage('tooling/config', { name: 'config' });
}

function relative(folders: readonly string[]): string[] {
  return folders
    .map((folder) => path.relative(root, folder).split(path.sep).join('/'))
    .sort();
}

describe('findWorkspacePackages', () => {
  it('reads pnpm-workspace.yaml globs, honouring exclusions and skipping node_modules', async () => {
    await writeMonorepo();
    await writePackage('packages/legacy', { name: 'legacy' });
    await writePackage('packages/ui/node_modules/dep', { name: 'dep' });
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      "packages:\n  - 'apps/*'\n  - 'packages/*'\n  - tooling/config/\n  - '!packages/legacy'\n",
    );

    const packages = await findWorkspacePackages(root);

    expect([...packages.keys()].sort()).toEqual([
      'api',
      'config',
      'ext',
      'html',
      'ui',
      'users',
      'utils',
      'web',
    ]);
    expect(packages.get('ui')).toBe(path.join(root, 'packages', 'ui'));
  });

  it('reads the package.json workspaces field in both of its shapes', async () => {
    await writePackage('packages/ui', { name: 'ui' });

    await writePackage('.', { name: 'root', workspaces: ['packages/*'] });
    expect([...(await findWorkspacePackages(root)).keys()]).toEqual(['ui']);

    await writePackage('.', { name: 'root', workspaces: { packages: ['packages/*'] } });
    expect([...(await findWorkspacePackages(root)).keys()]).toEqual(['ui']);
  });

  it('finds nothing in a repository without workspaces', async () => {
    await writePackage('.', { name: 'extension' });
    await expect(findWorkspacePackages(root)).resolves.toEqual(new Map());

    // pnpm-workspace.yaml can hold settings alone, for a single package.
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'catalog:\n  react: ^19.0.0\n',
    );
    await expect(findWorkspacePackages(root)).resolves.toEqual(new Map());
  });
});

describe('collectWorkspaceFolders', () => {
  it('follows every dependency field transitively, through cycles', async () => {
    await writeMonorepo();
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages: [apps/*, packages/*, tooling/*]',
    );
    const packages = await findWorkspacePackages(root);

    const folders = await collectWorkspaceFolders(
      path.join(root, 'apps/ext'),
      packages,
      [],
    );

    expect(relative(folders)).toEqual([
      'apps/ext',
      'packages/api',
      'packages/html',
      'packages/ui',
      'packages/users',
      'packages/utils',
      'tooling/config',
    ]);
  });

  it('leaves out ignored packages and what only they reach', async () => {
    await writeMonorepo();
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages: [apps/*, packages/*, tooling/*]',
    );
    const packages = await findWorkspacePackages(root);

    const folders = await collectWorkspaceFolders(path.join(root, 'apps/ext'), packages, [
      'api',
      'config',
    ]);

    expect(relative(folders)).toEqual([
      'apps/ext',
      'packages/html',
      'packages/ui',
      'packages/utils',
    ]);
  });

  it('returns just the package without workspaces', async () => {
    await expect(collectWorkspaceFolders(root, new Map(), [])).resolves.toEqual([root]);
  });
});

describe('findWorkspaceRoot', () => {
  it('finds the nearest workspace root, which need not be the repository root', async () => {
    await writePackage('frontend', { name: 'frontend', workspaces: ['apps/*'] });
    await writePackage('frontend/apps/ext', { name: 'ext' });

    await expect(
      findWorkspaceRoot(path.join(root, 'frontend/apps/ext'), root),
    ).resolves.toBe(path.join(root, 'frontend'));
  });

  it('stops at the repository root', async () => {
    await writePackage('apps/ext', { name: 'ext' });

    await expect(
      findWorkspaceRoot(path.join(root, 'apps/ext'), root),
    ).resolves.toBeUndefined();
  });
});
