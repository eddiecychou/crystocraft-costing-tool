import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createOcDayStore } from '../src/ocDay.js'
import { ocDateOnly, untilHongKongMidnight, formatOcDateTime } from '../src/ocTime.js'
import { calendarClock } from './local-day-clock.mjs'

function fixture() {
  const start = Date.parse('2026-10-17T15:59:59Z')
  const clock = calendarClock(start), doc = new EventTarget()
  doc.visibilityState = 'visible'
  return { clock, doc, store: createOcDayStore({ now: () => new Date(clock.now()), host: clock.host, doc }) }
}
test('shared clock updates exactly at Hong Kong midnight without a data event', () => {
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
  clock.setTime(Date.parse('2026-10-20T01:00:00Z')) // suspended timers never fired
  if (event === 'visibilitychange') {
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event(event)); assert.equal(calls, 0)
    doc.visibilityState = 'visible'
  }
  ;(event === 'visibilitychange' ? doc : clock.host).dispatchEvent(new Event(event))
  assert.equal(store.getSnapshot(), '2026-10-20'); assert.equal(calls, 1)
  off(); clock.setTime(Date.parse('2026-10-20T16:00:00Z'))
  doc.dispatchEvent(new Event('visibilitychange')); clock.host.dispatchEvent(new Event('focus'))
  assert.equal(calls, 1); assert.equal(clock.pending(), 0)
  const again = store.subscribe(() => calls++)
  assert.equal(store.getSnapshot(), '2026-10-21'); again()
})
test('watchdog corrects a backwards calendar change while still focused', () => {
  const { clock, store } = fixture(); let calls = 0
  const off = store.subscribe(() => calls++)
  clock.setTime(Date.parse('2026-10-16T04:00:00Z'))
  // Simulate the browser delivering its next interval after a system clock change.
  clock.fireIntervals()
  assert.equal(store.getSnapshot(), '2026-10-16'); assert.equal(calls, 1)
  off()
})
test('Hong Kong midnight is independent of device timezone and daylight-saving changes', () => {
  for (const zone of ['UTC', 'Australia/Sydney', 'America/New_York', 'America/Los_Angeles']) {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'; import {untilHongKongMidnight,ocDateOnly,formatOcDateTime} from './src/ocTime.js';
      assert.equal(ocDateOnly(new Date('2026-10-17T15:59:59Z')),'2026-10-17');
      assert.equal(ocDateOnly(new Date('2026-10-17T16:00:00Z')),'2026-10-18');
      assert.equal(untilHongKongMidnight(new Date('2026-10-17T15:59:59Z')),1000);
      for (const day of ['2026-10-03','2026-04-04','2026-03-07','2026-10-31'])
        assert.equal(untilHongKongMidnight(new Date(day+'T16:00:00Z')),86400000);
      assert.match(formatOcDateTime('2026-10-17T16:00:00Z',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),/18 Oct.*00:00/);
    `], { env: { ...process.env, TZ: zone } })
  }
  assert.equal(untilHongKongMidnight(new Date('2026-12-31T15:59:59Z')), 1000)
  assert.equal(untilHongKongMidnight(new Date('2028-02-29T15:59:59Z')), 1000)
})
test('chosen dates stay unchanged while timestamp and legacy dates use Hong Kong time', () => {
  const date = new Date('2026-10-17T16:00:00Z')
  assert.equal(ocDateOnly('2026-10-17'),'2026-10-17')
  assert.equal(ocDateOnly(date),'2026-10-18')
  assert.equal(ocDateOnly({toDate:()=>date}),'2026-10-18')
  assert.equal(ocDateOnly({seconds:date.getTime()/1000}),'2026-10-18')
  assert.equal(ocDateOnly('invalid'),'')
})
