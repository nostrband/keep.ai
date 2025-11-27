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
