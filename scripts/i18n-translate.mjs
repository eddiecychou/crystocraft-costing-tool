#!/usr/bin/env node
// Fill src/i18n/zh-Hans.js with Simplified-Chinese for every t('…') key that
// doesn't have one yet, using the DeepSeek chat API.
//
//   DEEPSEEK_API_KEY=sk-… node scripts/i18n-translate.mjs            # top up missing
//   DEEPSEEK_API_KEY=sk-… node scripts/i18n-translate.mjs --dry      # list what's missing, don't call the API
//   DEEPSEEK_API_KEY=sk-… node scripts/i18n-translate.mjs --all      # re-translate everything (overwrites, keeps nothing)
//
// It scans src/**/*.{js,jsx} for t('literal') / t("literal") calls (template
// literals and dynamic keys are skipped — those get wrapped as plain literals
// or added to zh-Hans.js by hand). Existing entries in zh-Hans.js are kept as
// they are unless --all, so hand-corrections survive a re-run.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const OUT = join(SRC, 'i18n', 'zh-Hans.js')
const KEY = process.env.DEEPSEEK_API_KEY
const MODE = process.argv.includes('--all') ? 'all' : process.argv.includes('--dry') ? 'dry' : 'topup'

// ── 1. collect t('…') keys ───────────────────────────────────────────────────
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|tsx?)$/.test(p) ? [p] : []
})
// t('…')  or  t("…")  — first argument only, no escaped-quote handling needed
// because our UI strings don't contain the same quote char unescaped.
const CALL = /\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g
const keys = new Set()
for (const f of walk(SRC)) {
  if (f.startsWith(OUT)) continue
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(CALL)) keys.add(m[2].replace(/\\(['"])/g, '$1'))
}
// Strings reached through a variable key — config labels (statuses, categories,
// movement types, merge fields) wrapped as t(SOME_MAP[x]). The regex can't see
// those, so list the literal English values here.
const EXTRA = join(ROOT, 'scripts', 'i18n-extra-keys.json')
try {
  for (const k of JSON.parse(readFileSync(EXTRA, 'utf8'))) keys.add(k)
} catch { /* optional */ }
const allKeys = [...keys].sort((a, b) => a.localeCompare(b))
console.log(`Found ${allKeys.length} keys (t() calls + extra list)`)

// ── 2. load existing catalogue ──────────────────────────────────────────────
let existing = {}
try {
  existing = (await import(OUT + `?t=${Date.now()}`)).default || {}
} catch { /* first run */ }

const todo = MODE === 'all' ? allKeys : allKeys.filter((k) => !(k in existing))
console.log(`${todo.length} to translate (${MODE})`)
if (MODE === 'dry') { todo.forEach((k) => console.log('  ·', k)); process.exit(0) }
if (!todo.length) { console.log('Nothing to do.'); process.exit(0) }
if (!KEY) { console.error('Set DEEPSEEK_API_KEY'); process.exit(1) }

// ── 3. translate in batches ────────────────────────────────────────────────
const SYSTEM = [
  'You translate UI microcopy for an internal manufacturing / procurement operations tool',
  'from English into Simplified Chinese (zh-Hans). These are button labels, table headers,',
  'field labels, tooltips and short status lines — keep them terse, in the register a native',
  'Chinese ERP would use. Do NOT translate: product/company names, currency codes, or the',
  'placeholder tokens in curly braces such as {n}, {a}, {b} — copy those through verbatim.',
  'Preserve leading symbols like "+" or "→" and surrounding punctuation.',
  'Glossary (use consistently): component 元件 · critical component 关键元件 · supplier 供应商 ·',
  'purchase order 采购订单 · PO 采购订单 · MOQ 最小起订量 · lead time 交期 · unit price 单价 ·',
  'stock / inventory 库存 · on hand 现有量 · reserved 已预留 · available 可用量 · reorder 补货 ·',
  'reorder point 补货点 · quote / quotation 报价单 · plating 电镀 · finish 表面处理 · packaging 包装 ·',
  'crystal 水晶 · finished goods 成品 · receive (stock) 入库 · draft 草稿 · issued 已下单 · received 已收货.',
  'Return ONLY a JSON object mapping each exact input string to its Chinese translation.',
].join(' ')

const call = async (batch) => {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 1.0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(batch) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  return JSON.parse(j.choices[0].message.content)
}

const merged = { ...existing }
const SIZE = 40
for (let i = 0; i < todo.length; i += SIZE) {
  const batch = todo.slice(i, i + SIZE)
  process.stdout.write(`  batch ${i / SIZE + 1}/${Math.ceil(todo.length / SIZE)}… `)
  try {
    const out = await call(batch)
    let n = 0
    for (const k of batch) if (typeof out[k] === 'string' && out[k].trim()) { merged[k] = out[k].trim(); n++ }
    console.log(`${n}/${batch.length}`)
  } catch (e) {
    console.log('FAILED —', e.message)
  }
}

// ── 4. write zh-Hans.js ────────────────────────────────────────────────────
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
const body = Object.keys(merged).sort((a, b) => a.localeCompare(b))
  .map((k) => `  '${esc(k)}': '${esc(merged[k])}',`).join('\n')
writeFileSync(OUT, `// Simplified-Chinese UI strings, keyed by the English source string.
// Generated by scripts/i18n-translate.mjs (DeepSeek) and hand-corrected in
// place — a re-run only adds missing keys, so corrections are kept.
// Anything not listed here renders in English.
export default {
${body}
}
`)
console.log(`Wrote ${Object.keys(merged).length} entries to ${relative(ROOT, OUT)}`)
