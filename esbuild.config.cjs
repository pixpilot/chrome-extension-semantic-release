const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const esbuild = require('esbuild');

const packageJsonRequire =
  /\brequire\((?<quote>["'])(?<specifier>\.{1,2}\/(?:[^"'/]+\/)*package\.json)\k<quote>\)/gu;

/**
 * semantic-release and @semantic-release/github read their own package.json
 * through `createRequire(import.meta.url)`, which esbuild cannot follow, so the
 * bundle would look for it next to dist/index.js at runtime. Rewrite those
 * calls into JSON imports that esbuild inlines.
 */
const inlineCreateRequirePackageJson = {
  name: 'inline-create-require-package-json',
  setup(build) {
    // esbuild filters are Go regular expressions, which reject JavaScript flags.
    // eslint-disable-next-line require-unicode-regexp
    build.onLoad({ filter: /node_modules.*\.js$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, 'utf8');
      if (!source.includes('createRequire')) return undefined;

      const imports = [];
      const contents = source.replace(packageJsonRequire, (_match, _quote, specifier) => {
        const name = `__packageJson${imports.length}`;
        imports.push(`import ${name} from ${JSON.stringify(specifier)};`);
        return name;
      });

      if (imports.length === 0) return undefined;

      return {
        contents: `${imports.join('\n')}\n${contents}`,
        loader: 'js',
        resolveDir: path.dirname(args.path),
      };
    });
  },
};

esbuild
  .build({
    entryPoints: ['./src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node24',
    outdir: 'dist',
    format: 'esm',
    banner: {
      // Aliased because bundled modules import `createRequire` themselves.
      js: "import { createRequire as __bundleCreateRequire } from 'node:module'; const require = __bundleCreateRequire(import.meta.url);",
    },
    // cosmiconfig only loads TypeScript for a TypeScript semantic-release
    // config; bundling it would add ~10 MB.
    external: ['typescript'],
    plugins: [inlineCreateRequirePackageJson],
    sourcemap: false,
    tsconfig: 'tsconfig.build.json',
    logLevel: 'info',
  })
  .catch(() => process.exit(1));
