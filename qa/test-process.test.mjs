import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { runNodeTest } from './test-process.mjs'

test('process guard preserves a successful child and its real output', () => {
  const result = runNodeTest(['-e', 'console.log("fixture passed")'], { stdio: 'pipe' })
  assert.equal(result.status, 0); assert.equal(result.stdout.trim(), 'fixture passed')
})

test('a failed child remains a failure, with the original exit code', () => {
  assert.throws(() => runNodeTest(['-e', 'process.exit(7)'], { stdio: 'pipe' }),
    error => error.code === 'QA_PROCESS_FAILED' && error.exitCode === 7)
})

test('an event-loop-blocked Node test worker cannot defeat the parent deadline or become a pass', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'blocked-node-test-')), file = join(scratch, 'blocked.test.mjs')
  t.after(() => rm(scratch, { recursive: true, force: true }))
  await writeFile(file, "import {test} from 'node:test';console.log('blocked fixture');test('blocked worker',()=>{while(true){}})")
  assert.throws(() => runNodeTest(['--test', file], { label: 'blocked fixture', timeoutMs: 1500, stdio: 'pipe', env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' } }),
    error => error.code === 'QA_PROCESS_TIMEOUT' && error.stdout.includes('blocked fixture') && /workers terminated/.test(error.message))
})

test('timeout stops a child test process and its descendant worker', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'workspace-process-')), marker = join(scratch, 'heartbeat')
  let failure
  t.after(async () => {
    if (failure?.childPid > 0 && process.platform !== 'win32') {
      try { process.kill(-failure.childPid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    await rm(scratch, { recursive: true, force: true })
  })
  const worker = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),20)`
  const parent = `const{spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(worker)}],{stdio:'ignore'});setInterval(()=>{},1000)`
  try { runNodeTest(['-e', parent], { label: 'worker fixture', timeoutMs: 1500, stdio: 'pipe' }) }
  catch (error) { failure = error }
  assert.equal(failure?.code, 'QA_PROCESS_TIMEOUT')
  // Signal delivery is asynchronous; let any in-flight filesystem write settle.
  await delay(100)
  const stopped = await readFile(marker, 'utf8')
  await delay(100)
  assert.equal(await readFile(marker, 'utf8'), stopped, 'Descendant heartbeat must stop after the process-group deadline')
})

test('callers cannot accidentally disable the process deadline', () => {
  for (const timeoutMs of [0, -1, Infinity, NaN]) {
    assert.throws(() => runNodeTest(['-e', 'process.exit(0)'], { timeoutMs, stdio: 'pipe' }), /finite positive/)
  }
})
