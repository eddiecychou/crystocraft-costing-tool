#!/usr/bin/env node
// Derive the zh-hant "simplified-only" guard for
// `seo-control-plane/validate-payload.mjs` from OpenCC's STCharacters.txt — and,
// with `--check`, prove the list committed there is exactly that derivation.
//
//   node scripts/derive-zh-hant-simplified.mjs --check
//   node scripts/derive-zh-hant-simplified.mjs --print
//   node scripts/derive-zh-hant-simplified.mjs --st /path/to/STCharacters.txt --check
//
// WHY THIS EXISTS (LESSONS-LEARNED.md L-49). The guard used to be a
// hand-curated 193-character list. Measured against the dictionary it was 4.9%
// complete — it missed 订 礼, so 訂製 and 禮品 passed — and it contained seven
// characters that ARE valid Traditional (云 厂 叶 后 广 征 种, as in 皇后 /
// 征戰), so it rejected correct text. A guard list is a coverage claim; derive
// it, then check it, or it is just an assertion about the characters someone
// happened to think of.
//
// The list MUST NOT be hand-edited. If this check fails, either the dictionary
// changed or someone edited the constant — decide which, then regenerate.
//
// Dictionary: OpenCC — https://github.com/BYVoid/OpenCC
//   data/dictionary/STCharacters.txt (Apache-2.0), format `simplified \t trad…`.
//   A cached copy normally sits at
//   "$HOME/Developer/Deepseek Workbench/.tools/opencc/STCharacters.txt".
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// A character `s` is simplified-only when the mapping actually changes it AND
// `s` never appears on the traditional side of any mapping. The second test is
// what removes the ambiguous characters (台 只 里 后 云 谷 回 价 …), which is why
// the six the old list special-cased (只 繁 慕 谷 回 台) are excluded for free.
//
// OpenCC's ST dictionary also normalises ORTHOGRAPHIC VARIANTS (床 -> 牀,
// 秘 -> 祕, 群 -> 羣, 峰 -> 峯) where the left-hand character is standard
// Traditional. Those are not simplifications; flagging them is a false alarm on
// correct text.
const VARIANT_NOT_SIMPLIFIED = new Set([...'床秘群峰'])

const DEFAULT_ST = path.join(
  homedir(), 'Developer', 'Deepseek Workbench', '.tools', 'opencc', 'STCharacters.txt',
)

export function deriveSimplifiedOnly(stText) {
  const ST = new Map()
  for (const line of stText.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const p = line.split('\t')
    if (p.length < 2) continue
    const s = p[0].trim()
    const ts = p[1].trim().split(/\s+/).filter(Boolean)
    // `[...s].length`, NOT `s.length`: the latter counts UTF-16 units and
    // silently drops every CJK Extension-B character (U+20000+).
    if ([...s].length === 1 && ts.length) ST.set(s, ts)
  }
  const trad = new Set()
  for (const ts of ST.values()) for (const t of ts) trad.add(t)
  const out = []
  for (const [s, ts] of ST) {
    if (ts[0] === s) continue
    if (trad.has(s)) continue
    if (VARIANT_NOT_SIMPLIFIED.has(s)) continue
    out.push(s)
  }
  return { list: out.join(''), mappings: ST.size }
}

/** The list currently committed in validate-payload.mjs. */
export function committedList(root) {
  const src = readFileSync(path.join(root, 'seo-control-plane', 'validate-payload.mjs'), 'utf8')
  const m = src.match(/const SIMPLIFIED = '([^']*)'/)
  if (!m) throw new Error('could not find `const SIMPLIFIED = \'…\'` in validate-payload.mjs')
  return m[1]
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flag = (n) => argv.includes(n)
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
  const stPath = opt('--st') || DEFAULT_ST
  const root = path.resolve(fileURLToPath(import.meta.url), '..', '..')

  if (!existsSync(stPath)) {
    console.error(`STCharacters.txt not found: ${stPath}\n  pass --st <path> (OpenCC data/dictionary/STCharacters.txt)`)
    process.exit(2)
  }

  const { list, mappings } = deriveSimplifiedOnly(readFileSync(stPath, 'utf8'))
  if (flag('--print')) { process.stdout.write(list + '\n'); process.exit(0) }

  const committed = committedList(root)
  const derived = new Set(list)
  const have = new Set(committed)
  const missing = [...derived].filter(c => !have.has(c))
  const extra = [...have].filter(c => !derived.has(c))

  console.log(`dictionary             : ${stPath}`)
  console.log(`mappings parsed        : ${mappings}`)
  console.log(`derived simplified-only: ${[...list].length} characters`)
  console.log(`committed in validator : ${[...committed].length} characters`)

  if (!missing.length && !extra.length) {
    console.log('\nOK — the committed guard is exactly the derivation.')
    process.exit(0)
  }
  console.log(`\nMISMATCH — ${missing.length} missing, ${extra.length} extra:`)
  if (missing.length) console.log(`  missing: ${missing.slice(0, 80).join('')}${missing.length > 80 ? ' …' : ''}`)
  if (extra.length) console.log(`  extra  : ${extra.slice(0, 80).join('')}${extra.length > 80 ? ' …' : ''}`)
  console.log('\nThe list is derived, not hand-picked. Regenerate rather than editing it (L-49).')
  process.exit(1)
}
