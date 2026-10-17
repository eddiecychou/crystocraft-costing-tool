// Deterministic browser timers only; Firebase/network and test polling stay real.
export function calendarClock(start) {
  let now = start, sequence = 0
  const timers = new Map(), host = new EventTarget()
  const add = (fn, ms, repeat = false) => {
    const id = ++sequence
    timers.set(id, { fn, ms, repeat, at: now + ms })
    return id
  }
  Object.assign(host, {
    setTimeout: (fn, ms) => add(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => add(fn, ms, true), clearInterval: id => timers.delete(id),
  })
  return {
    host, now: () => now, pending: () => timers.size,
    setTime: value => { now = value },
    fireIntervals() {
      const due = [...timers.values()].filter(t => t.repeat)
      if (!due.length) throw Error('No interval scheduled')
      for (const timer of due) { timer.at = now + timer.ms; timer.fn() }
    },
    advance(ms) {
      const end = now + ms
      for (let guard = 0; guard < 10000; guard++) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) { now = end; return }
        const [id, timer] = next
        now = timer.at
        if (timer.repeat) timer.at += timer.ms
        else timers.delete(id)
        timer.fn()
      }
      throw Error('Runaway calendar timers')
    },
    installOn(target) {
      const saved = {}
      for (const key of ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']) {
        saved[key] = target[key]; target[key] = host[key]
      }
      return () => Object.assign(target, saved)
    },
  }
}
