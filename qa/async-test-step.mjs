// Test diagnostics only. Native Node timers stay independent of browser clocks.
export async function testStep(label, operation, { timeoutMs = 15000, log = console.log } = {}) {
  log(`[workspace-sync] start: ${label}`)
  let timer
  try {
    const value = await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error(`Workspace test stalled at: ${label} (${timeoutMs}ms)`),
          { code: 'QA_STEP_TIMEOUT' },
        )), timeoutMs)
      }),
    ])
    log(`[workspace-sync] done: ${label}`)
    return value
  } finally {
    clearTimeout(timer)
  }
}
