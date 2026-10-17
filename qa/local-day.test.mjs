import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createLocalDayStore, untilLocalMidnight } from '../src/localDay.js'
import { calendarClock } from './local-day-clock.mjs'

function fixture() {
  const start = new Date(2026, 9, 17, 23, 59, 59).getTime()
  const clock = calendarClock(start), doc = new EventTarget()
  doc.visibilityState = 'visible'
  return { clock, doc, store: createLocalDayStore({ now: () => new Date(clock.now()), host: clock.host, doc }) }
}
test('shared clock updates exactly at local midnight without a data event', () => {
  const { clock, store } = fixture(); let a = 0, b = 0
  const offA = store.subscribe(() => a++), offB = store.subscribe(() => b++)
  assert.equal(clock.pending(), 2, 'One midnight timer and watchdog shared by subscribers')
  assert.equal(store.getSnapshot(), '2026-10-17')
  clock.advance(999); assert.equal(a, 0)
  clock.advance(1); assert.equal(store.getSnapshot(), '2026-10-18'); assert.equal(a, 1); assert.equal(b, 1)
  clock.advance(60000); assert.equal(a, 1, 'No redundant same-day notification')
  offA(); assert.equal(clock.pending(), 2); offB(); assert.equal(clock.pending(), 0)
})
for (const event of ['focus', 'pageshow', 'visibilitychange']) test(`sleeping tab catches up on ${event} and releases listeners on unmount`, () => {
  const { clock, store, doc } = fixture(); let calls = 0
  const off = store.subscribe(() => calls++)
  clock.setTime(new Date(2026, 9, 20, 9).getTime()) // suspended timers never fired
  if (event === 'visibilitychange') {
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event(event)); assert.equal(calls, 0)
    doc.visibilityState = 'visible'
  }
  ;(event === 'visibilitychange' ? doc : clock.host).dispatchEvent(new Event(event))
  assert.equal(store.getSnapshot(), '2026-10-20'); assert.equal(calls, 1)
  off(); clock.setTime(new Date(2026, 9, 21).getTime())
  doc.dispatchEvent(new Event('visibilitychange')); clock.host.dispatchEvent(new Event('focus'))
  assert.equal(calls, 1); assert.equal(clock.pending(), 0)
  const again = store.subscribe(() => calls++)
  assert.equal(store.getSnapshot(), '2026-10-21'); again()
})
test('watchdog corrects a backwards calendar change while still focused', () => {
  const { clock, store } = fixture(); let calls = 0
  const off = store.subscribe(() => calls++)
  clock.setTime(new Date(2026, 9, 16, 12).getTime())
  // Simulate the browser delivering its next interval after a system clock change.
  clock.fireIntervals()
  assert.equal(store.getSnapshot(), '2026-10-16'); assert.equal(calls, 1)
  off()
})
test('local-midnight scheduling follows 23/25-hour DST days and calendar boundaries', () => {
  for (const [zone, cases] of [
    ['Australia/Sydney', [[2026, 9, 4, 23], [2026, 3, 5, 25]]],
    ['America/New_York', [[2026, 2, 8, 23], [2026, 10, 1, 25]]],
    ['UTC', [[2026, 9, 4, 24], [2026, 3, 5, 24]]],
  ]) {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'; import {untilLocalMidnight} from './src/localDay.js';
      for (const [y,m,d,h] of ${JSON.stringify(cases)}) assert.equal(untilLocalMidnight(new Date(y,m,d)),h*3600000);
    `], { env: { ...process.env, TZ: zone } })
  }
  assert.equal(untilLocalMidnight(new Date(2026, 11, 31, 23, 59, 59)), 1000)
  assert.equal(untilLocalMidnight(new Date(2028, 1, 29, 23, 59, 59)), 1000)
})
