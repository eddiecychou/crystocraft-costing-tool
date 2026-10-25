// Release preflight only. Reads GitHub; never builds, deploys or changes settings.
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'

export const REPOSITORY = 'eddiecychou/crystocraft-costing-tool'
export const REQUIRED_JOBS = ['product-search', 'customer-merge-emulator']
const API = `https://api.github.com/repos/${REPOSITORY}`
const WORKFLOW = '.github/workflows/product-search.yml'
const SHA = /^[a-f0-9]{40}$/

function commitSha(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw Error('A full lowercase commit SHA is required. Deployment blocked.')
  return value
}

export function releaseCommit({env=process.env, cwd=process.cwd()}={}) {
  const git = args => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim()
  let head
  try {
    head = commitSha(git(['rev-parse','HEAD']))
    if (git(['status','--porcelain','--untracked-files=normal'])) throw Error('dirty')
  } catch { throw Error('Release requires a clean, committed checkout. Deployment blocked.') }
  if (env.NETLIFY === 'true' && !env.COMMIT_REF) throw Error('Netlify COMMIT_REF is missing. Deployment blocked.')
  if (env.COMMIT_REF && commitSha(env.COMMIT_REF) !== head) throw Error('COMMIT_REF does not match the checked-out commit. Deployment blocked.')
  return head
}

async function github(path, fetchImpl, token) {
  const headers = {Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'}
  if (token) headers.Authorization = `Bearer ${token}`
  let response
  try { response = await fetchImpl(API+path, {headers, signal:AbortSignal.timeout(20000), redirect:'error'}) }
  catch { throw Error('Cannot reach GitHub to verify release checks. Deployment blocked.') }
  if (!response.ok) throw Error(`GitHub CI verification returned HTTP ${response.status}. Deployment blocked.`)
  try { return await response.json() } catch { throw Error('GitHub returned an invalid CI response. Deployment blocked.') }
}

export async function checkReleaseCi(sha, {fetchImpl=fetch, token=process.env.GITHUB_TOKEN}={}) {
  commitSha(sha)
  const data = await github(`/actions/workflows/product-search.yml/runs?head_sha=${sha}&per_page=100`, fetchImpl, token)
  if (!Array.isArray(data.workflow_runs) || data.total_count > 100) throw Error('Cannot identify the latest workflow run. Deployment blocked.')
  const runs = data.workflow_runs.filter(run => run.head_sha === sha && typeof run.path === 'string' && run.path.split('@')[0] === WORKFLOW &&
    run.head_repository?.full_name === REPOSITORY && ['push','pull_request','workflow_dispatch'].includes(run.event))
  const run = runs.sort((a,b) => b.id-a.id)[0]
  if (!run) return {state:'pending', sha, reason:'No matching GitHub workflow run for this commit.'}
  if (!Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw Error('Invalid workflow identity. Deployment blocked.')
  const url = `https://github.com/${REPOSITORY}/actions/runs/${run.id}`
  if (run.status !== 'completed') return {state:'pending', sha, url, reason:`GitHub workflow is ${run.status || 'unfinished'}.`}
  if (run.conclusion !== 'success') throw Error(`GitHub workflow ${run.id} is ${run.conclusion || 'not successful'}. Deployment blocked. ${url}`)

  // Require both jobs from this attempt, not an older successful attempt or SHA.
  const payload = await github(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, fetchImpl, token)
  if (!Array.isArray(payload.jobs) || payload.total_count !== payload.jobs.length) throw Error('Incomplete workflow job list. Deployment blocked.')
  for (const name of REQUIRED_JOBS) {
    const matches = payload.jobs.filter(job => job.name === name)
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success' ||
        matches[0].head_sha !== sha || matches[0].run_id !== run.id) {
      throw Error(`Required GitHub job ${name} has not passed for this commit and attempt. Deployment blocked. ${url}`)
    }
  }
  return {state:'passed', sha, url, runId:run.id, attempt:run.run_attempt, jobs:[...REQUIRED_JOBS]}
}

export async function waitForReleaseCi(sha, {
  wait=false, timeoutMs=15*60000, intervalMs=30000, now=Date.now, sleep=delay, onPending=()=>{}, ...options
}={}) {
  const started = now()
  for (;;) {
    const result = await checkReleaseCi(sha, options)
    if (result.state === 'passed') return result
    onPending(result)
    const remaining = timeoutMs-(now()-started)
    if (!wait || remaining <= 0) throw Error(`${result.reason} Both required jobs must pass before deployment.`)
    await sleep(Math.min(intervalMs, remaining))
  }
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--wait')) throw Error('Usage: node scripts/check-release-ci.mjs [--wait]')
  const sha = releaseCommit()
  const result = await waitForReleaseCi(sha, {wait:process.argv.includes('--wait'), onPending:r=>console.log(`[release CI] ${sha.slice(0,12)}: ${r.reason}`)})
  console.log(`[release CI] PASS ${sha}: ${result.jobs.join(' + ')}; attempt ${result.attempt}. ${result.url}`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[release CI] ${error.message}`); process.exitCode=1 })
}
