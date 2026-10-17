import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { outreachDaysAgo, outreachBlocked } from '../src/outreachTiming.js'
import { formatOcDate } from '../src/ocTime.js'

test('draft cooldowns remain full elapsed durations across HKT midnight on every device', () => {
  const old = process.env.TZ
  try { for (const zone of ['UTC', 'Australia/Sydney', 'America/Los_Angeles', 'Asia/Hong_Kong']) {
    process.env.TZ = zone
    const sent = '2026-10-03T16:00:01Z'
    for (const days of [14, 21]) {
      const end = Date.parse(sent) + days * 86400000
      assert.ok(outreachDaysAgo(sent, end - 1) < days)
      assert.equal(outreachDaysAgo(sent, end), days)
    }
    assert.ok(outreachDaysAgo(sent, Date.parse('2026-10-17T16:00:00Z')) < 14)
    assert.equal(formatOcDate('2026-10-17T16:00:00Z'), '18/10/2026')
    assert.equal(outreachDaysAgo('2026-10-18 00:00:00', Date.parse('2026-10-18T16:00:00Z')), 1)
    assert.equal(outreachDaysAgo({seconds:Date.parse(sent)/1000}, Date.parse(sent)), 0)
    assert.equal(outreachDaysAgo({toDate:()=>new Date(sent)}, Date.parse(sent)), 0)
    assert.equal(outreachDaysAgo(null), Infinity)
    assert.equal(outreachDaysAgo('invalid'), 0)
    assert.equal(outreachBlocked('2026-10-18 00:00:00', Date.parse('2026-10-17T15:59:59Z')), true)
    assert.equal(outreachBlocked('2026-10-18 00:00:00', Date.parse('2026-10-17T16:00:00Z')), false)
    assert.equal(outreachBlocked('invalid'), true)
  } } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old }
})

test('Daily Drafts uses shared timing without midnight generation, deletion or send scheduling', () => {
  const ui = readFileSync('src/marketing/DailyDrafts.jsx', 'utf8')
  assert.match(ui, /outreachBlocked\(e.blockOutreachUntil, now\)/)
  assert.match(ui, /daysAgo\(e.lastOutreachAt, now\)/)
  assert.match(ui, /generation and sending are manual/)
  assert.doesNotMatch(ui, /useOcToday|setInterval|setUTCHours|setHours|toISOString\(\).slice/)
  assert.match(readFileSync('netlify/edge-functions/generate-outreach-drafts.js','utf8'), /Admin-triggered, no cron/)
})
