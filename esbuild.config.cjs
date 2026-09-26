const process = require('node:process');
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['./src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outdir: 'dist',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    external: ['string_decoder', 'fs', 'path', 'os', 'util', 'stream'],
    sourcemap: false,
    tsconfig: 'tsconfig.build.json',
    logLevel: 'info',
  })
  .catch(() => process.exit(1));
