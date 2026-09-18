import { build } from 'esbuild'
await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'], bundle: true,
  platform: 'node', target: 'node22', outdir: 'dist-electron',
  external: ['electron', 'ssh2', 'electron-updater'], format: 'cjs',
})
