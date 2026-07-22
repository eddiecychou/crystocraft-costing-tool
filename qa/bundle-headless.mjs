// Bundle a src/ module for headless running, with Firebase stubbed out.
//
//   node qa/bundle-headless.mjs qa/mrp-crystals.mjs /tmp/out.mjs
//
// src/firebase.js initialises a real Firestore app at import time, so anything
// importing it drags in grpc and dies on load before the code under test runs.
// esbuild's --alias flag rejects relative names, hence the resolve plugin.
import * as esbuild from 'esbuild'
import path from 'node:path'

const [entry, outfile] = process.argv.slice(2)
if (!entry || !outfile) {
  console.error('usage: node qa/bundle-headless.mjs <entry> <outfile>')
  process.exit(1)
}

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')

const stubFirebase = {
  name: 'stub-firebase',
  setup(build) {
    build.onResolve({ filter: /(^|\/)firebase$/ }, args => {
      // Only the app's own src/firebase module, not the firebase package.
      if (args.kind === 'import-statement' && args.path.startsWith('.')) {
        return { path: path.join(ROOT, 'qa', 'stub-firebase.js') }
      }
      return null
    })
    // The SDK entry points are never called in these checks.
    build.onResolve({ filter: /^firebase\// }, () => ({
      path: path.join(ROOT, 'qa', 'stub-firebase.js'),
    }))
  },
}

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [stubFirebase],
  logLevel: 'warning',
})
