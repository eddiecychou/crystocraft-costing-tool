import { spawnSync } from 'node:child_process'

// A parent-process deadline also works when a test blocks its own JS event loop.
// Never force a successful exit or leave the test runner's workers behind.
export function runNodeTest(args, { label = 'workspace page tests', timeoutMs = 90000, env = process.env, stdio = 'inherit' } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('A finite positive test-process deadline is required.')
  const grouped = process.platform !== 'win32'
  const childEnv = { ...env }
  // A new --test launcher must not inherit its parent's worker context:
  // Node otherwise skips the nested launch and can return a false success.
  delete childEnv.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, args, {
    env: childEnv, stdio, encoding: 'utf8', detached: grouped,
    timeout: timeoutMs, killSignal: 'SIGKILL',
  })
  const timedOut = result.error?.code === 'ETIMEDOUT'
  if (timedOut && grouped && result.pid > 0) {
    try { process.kill(-result.pid, 'SIGKILL') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  if (timedOut || result.error || result.status !== 0) {
    throw Object.assign(new Error(timedOut
      ? `${label} exceeded ${timeoutMs}ms; test process and workers terminated. See the last test/phase output above.`
      : `${label} failed (${result.error?.code || result.signal || result.status}).`), {
      code: timedOut ? 'QA_PROCESS_TIMEOUT' : 'QA_PROCESS_FAILED',
      childPid: result.pid, exitCode: result.status, stdout: result.stdout, stderr: result.stderr,
    })
  }
  return result
}
