import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const outfile = path.join(root, 'apple/Sources/NexoInterfazUI/kernel.js')
mkdirSync(path.dirname(outfile), { recursive: true })

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['src/embedded-entry.ts'],
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2022',
  outfile,
  inject: ['src/embedded/globals.js'],
  alias: {
    'node:fs': path.join(root, 'src/embedded/fs.js'),
    'node:path': path.join(root, 'src/embedded/path.js'),
    'node:crypto': path.join(root, 'src/embedded/crypto.js'),
  },
  banner: { js: '/* Generated from reconstruction/src. Do not edit. */' },
  logLevel: 'info',
})
