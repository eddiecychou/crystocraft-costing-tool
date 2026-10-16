import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const artifacts = ['validate-payload.mjs', 'validate-payload.test.mjs', 'safe-write.mjs', 'safe-write.test.mjs', 'yoast-indexable.mjs']
export function checkVendorSync({ repo, release, vendors }) {
  if (!/^[a-f0-9]{40}$/.test(release || '')) throw new Error('Provide the full immutable OC release commit from the release handoff; HEAD/branches are not accepted')
  if (!vendors?.length) throw new Error('Provide every active vendor directory with --vendor')
  const git = args => execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (git(['rev-parse', release + '^{commit}']).toString().trim() !== release) throw new Error('Release commit not available locally')
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  const rows = []
  for (const file of artifacts) {
    const expected = digest(git(['show', `${release}:seo-control-plane/${file}`]))
    for (const vendor of vendors) {
      let actual = null
      try { actual = digest(readFileSync(resolve(vendor, file))) } catch { /* missing is a failure */ }
      rows.push({ file, vendor, expected, actual, matches: actual === expected })
    }
  }
  return { release, passed: rows.every(r => r.matches), rows }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), vendors = []
    let repo, release
    while (args.length) {
      const key = args.shift(), value = args.shift()
      if (!value) throw new Error('Missing option value')
      if (key === '--repo') repo = value
      else if (key === '--release') release = value
      else if (key === '--vendor') vendors.push(value)
      else throw new Error('Unknown option: ' + key)
    }
    if (!repo) throw new Error('--repo required')
    const report = checkVendorSync({ repo, release, vendors })
    console.log(JSON.stringify(report, null, 2))
    if (!report.passed) console.error('Mismatch: STOP. Verify the intended deployed release; no copy commands or downgrade suggestions are generated.')
    process.exitCode = report.passed ? 0 : 1
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
