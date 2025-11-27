import esbuild from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  external: [
    'electron',
    'sqlite3',
    "@nostrband/crsqlite",
    'quickjs-emscripten',
    'quickjs-emscripten-core',
    '@jitl/quickjs-ffi-types',
    '@jitl/quickjs-wasmfile-debug-asyncify',
    '@jitl/quickjs-wasmfile-release-asyncify',
    '@jitl/quickjs-wasmfile-debug-sync',
    '@jitl/quickjs-wasmfile-release-sync',
  ]
};

await esbuild.build({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
});

await esbuild.build({
  ...common,
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs',
});

console.log('[esbuild] main & preload built');
