import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';

/**
 * A bundled extension ships whatever it imports, wherever package.json lists
 * it; monorepos often keep bundled workspace packages in devDependencies.
 */
export const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
] as const;

type Manifest = Partial<
  Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>
> & {
  name?: unknown;
  workspaces?: unknown;
};

/**
 * Finds the workspace root that contains `packageFolder`: the nearest folder
 * at or above it, up to the repository root, whose pnpm-workspace.yaml or
 * package.json `workspaces` (npm, Yarn, Bun) declares packages. The workspace
 * need not sit at the repository root.
 */
export async function findWorkspaceRoot(
  packageFolder: string,
  repositoryRoot: string,
): Promise<string | undefined> {
  for (let folder = packageFolder; ; folder = path.dirname(folder)) {
    // eslint-disable-next-line no-await-in-loop -- nearest match wins
    if ((await readWorkspacePatterns(folder)).length > 0) return folder;
    if (path.relative(repositoryRoot, folder) === '' || folder === path.dirname(folder)) {
      return undefined;
    }
  }
}

/** Maps every package of the workspace at `workspaceRoot` to its absolute folder. */
export async function findWorkspacePackages(
  workspaceRoot: string,
): Promise<Map<string, string>> {
  const patterns = await readWorkspacePatterns(workspaceRoot);
  const include = patterns
    .filter((pattern) => !pattern.startsWith('!'))
    .map((pattern) => `${trimSlashes(pattern)}/package.json`);
  const exclude = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .flatMap((pattern) => [
      trimSlashes(pattern.slice(1)),
      `${trimSlashes(pattern.slice(1))}/**`,
    ]);
  const packages = new Map<string, string>();

  if (include.length === 0) return packages;

  for await (const file of glob(include, {
    cwd: workspaceRoot,
    exclude: [...exclude, '**/node_modules/**'],
  })) {
    const folder = path.resolve(workspaceRoot, path.dirname(file));
    const { name } = await readManifest(folder);
    if (typeof name === 'string') packages.set(name, folder);
  }

  return packages;
}

/**
 * Returns `packageFolder` and the folders of every workspace package it depends
 * on, transitively. Packages named in `ignore` are left out together with
 * anything reachable only through them.
 */
export async function collectWorkspaceFolders(
  packageFolder: string,
  packages: ReadonlyMap<string, string>,
  ignore: readonly string[],
): Promise<string[]> {
  const folders = new Set([packageFolder]);

  if (packages.size === 0) return [...folders];

  // The set grows while it is walked: breadth-first over the dependency graph.
  for (const folder of folders) {
    // eslint-disable-next-line no-await-in-loop -- each step discovers the next
    const manifest = await readManifest(folder);

    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        const dependency = packages.get(name);
        if (dependency !== undefined && !ignore.includes(name)) folders.add(dependency);
      }
    }
  }

  return [...folders];
}

async function readWorkspacePatterns(folder: string): Promise<string[]> {
  const pnpmWorkspace = await readFile(path.join(folder, 'pnpm-workspace.yaml'), 'utf8')
    .then((text) => load(text) as { packages?: unknown } | null)
    .catch(() => undefined);

  if (pnpmWorkspace !== undefined) return toStrings(pnpmWorkspace?.packages);

  const { workspaces } = await readManifest(folder).catch((): Manifest => ({}));
  return toStrings(
    Array.isArray(workspaces)
      ? workspaces
      : (workspaces as { packages?: unknown } | undefined)?.packages,
  );
}

async function readManifest(folder: string): Promise<Manifest> {
  return JSON.parse(
    await readFile(path.join(folder, 'package.json'), 'utf8'),
  ) as Manifest;
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function trimSlashes(pattern: string): string {
  return pattern.replace(/^\.\//u, '').replace(/\/+$/u, '');
}
