// SEO control plane — Step 3, the validation gate.
//
// SSOT for "is this WordPress write payload safe to apply". Deterministic,
// pure (no I/O, no deps) — the DeepSeek Workbench vendors this file verbatim
// and runs every translation / generation payload through it BEFORE the write
// (and attaches the result as the `validation` field on each seo_batches
// item). When a new failure mode appears, a check is added HERE and the
// Workbench re-vendors.
//
// Every check maps to a Workbench LESSONS-LEARNED entry:
//   json_parses .............. B32
//   widget_count ............. B20 (stale-copy), §6.5
//   element_ids_preserved .... §3d, §6.5
//   length_anomaly ........... B6, §8b.1
//   wrong_language_chars ..... B33 / B35 (CJK leak), B6 (simplified in zh-hant)
//   placeholder_markers ...... B12
//   brand_terms_preserved .... §3c, §8b.5
//   sku_prefix_preserved ..... B12 (SKU-preserving name translation)
//   image_count_parity ....... §2 payload validation
//   heading_count_parity ..... §2
//   no_new_scripts_or_tables . §2
//   seo_title_no_double_brand . L-09, MASTER §4
//   seo_desc_length .......... §4, B47
//   translation_draft_only ... Rule 4 (never publish an unlinked translation)
//
// Usage:
//   import { validatePayload } from './validate-payload.mjs'
//   const v = validatePayload({ kind, lang, endpoint, payload, source })
//   if (!v.passed) throw new Error('validation failed: ' + v.checks.filter(c=>!c.ok).map(c=>c.name).join(', '))

// ── config ────────────────────────────────────────────────────────────────
export const BRAND_TERMS = ['Swarovski', 'Crystocraft', 'MagSafe', 'NFC', 'CrystoCoin', 'iPhone']

// Simplified-Chinese-only forms that must never appear in a zh-hant payload.
// Verbatim from the Workbench's translate-product.mjs SIMPLIFIED set.
const SIMPLIFIED = '这钥转涡设语门观复个们么头车马鸟鱼龙龟无云电风东长儿见贝专业义书乐发台亚为兰兴农军华区单卖卫历压厂严县参变只叶号后页团园图回国处备声实宝写对寻导寿将尔尘层属岁岂帐币帮广庄应庙废库开张弹强归当录径彻征从态怀总战忆忧怜恶恼恋恒恳悬惯慕懒戏积种红级结纪约纽纯纸纹线练组细终经统继续编缘维网纵繁纠谷购贡贫穷货质费账贵贺贷贸宾赞页顿预频颇领顾显题颜风飞饱饭饮养骄验体选锦钟铁银针锋铸镜闲间闻阅队阳阶际陆陈随隐难虽页颜题顾风飞马验'

const PLACEHOLDER_RX = /\b(por favor|please provide|translate this|as an ai|i cannot|i['’]m sorry|lorem ipsum|todo:)\b|请提供|请输入|需要翻译|\[placeholder\]/i
const CJK_RX = /[぀-ヿ㐀-鿿豈-﫿]/         // hiragana/katakana + CJK ideographs
const SCRIPT_RX = /<script[\s>]/i
const TABLE_RX = /<table[\s>]/i

// ── helpers ───────────────────────────────────────────────────────────────
const asString = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))

function parseElementor(v) {
  if (v == null) return null
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return undefined } // undefined = present-but-broken
}

// Walk an Elementor tree, yielding every node.
function* walk(node) {
  if (!node) return
  if (Array.isArray(node)) { for (const n of node) yield* walk(n) ; return }
  yield node
  if (node.elements) yield* walk(node.elements)
}
const isWidget = (n) => n && (n.elType === 'widget' || n.widgetType)
const TEXT_SETTING_KEYS = ['title', 'editor', 'heading', 'text', 'title_text', 'description_text', 'caption', 'button_text']

function widgetTexts(tree) {
  const out = []
  for (const n of walk(tree)) {
    if (!isWidget(n) || !n.settings) continue
    for (const k of TEXT_SETTING_KEYS) {
      if (typeof n.settings[k] === 'string' && n.settings[k].trim()) out.push({ id: n.id, key: k, text: n.settings[k] })
    }
  }
  return out
}
function elementIds(tree) {
  const s = new Set()
  for (const n of walk(tree)) if (n && n.id) s.add(n.id)
  return s
}

// Collect all human-readable text in a payload (top-level string fields +
// decoded Elementor widget text). Used for the language / placeholder scans.
function payloadText(payload) {
  const parts = []
  for (const [k, v] of Object.entries(payload || {})) {
    if (k === 'meta') continue
    if (typeof v === 'string') parts.push(v)
    else if (v && typeof v === 'object' && typeof v.rendered === 'string') parts.push(v.rendered)
  }
  const ed = parseElementor(payload?.meta?._elementor_data)
  if (ed && typeof ed === 'object') for (const w of widgetTexts(ed)) parts.push(w.text)
  for (const mk of ['_yoast_wpseo_title', '_yoast_wpseo_metadesc']) {
    const mv = payload?.meta?.[mk]
    if (typeof mv === 'string') parts.push(mv)
  }
  return parts.join('\n')
}

const countMatches = (str, rx) => (str.match(rx) || []).length
const stripTags = (s) => asString(s).replace(/<[^>]+>/g, ' ')

// ── the gate ──────────────────────────────────────────────────────────────
// kind: 'post' | 'page' | 'product'   lang: 'en'|'es'|'zh-hant'|'ja'|'fr'
// payload: the exact WP write body    source: the EN-original object it derives from (optional but recommended)
export function validatePayload({ kind, lang, endpoint = '', payload = {}, source = null } = {}) {
  const checks = []
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail })

  const isTranslation = !!lang && lang !== 'en'
  const text = payloadText(payload)
  const srcText = source ? payloadText(source) : ''

  // 1. Elementor JSON parses
  const edRaw = payload?.meta?._elementor_data
  const ed = parseElementor(edRaw)
  if (edRaw != null) add('json_parses', ed !== undefined, ed === undefined ? '_elementor_data does not JSON.parse' : '')

  // 2/3. structure vs source (only when both have Elementor data)
  const srcEd = source ? parseElementor(source?.meta?._elementor_data) : null
  if (ed && typeof ed === 'object' && srcEd && typeof srcEd === 'object') {
    const pw = [...walk(ed)].filter(isWidget).length
    const sw = [...walk(srcEd)].filter(isWidget).length
    add('widget_count', pw === sw, pw === sw ? '' : `payload ${pw} widgets vs source ${sw} (stale layout? B20)`)

    const pIds = elementIds(ed), sIds = elementIds(srcEd)
    const introduced = [...pIds].filter(id => !sIds.has(id))
    add('element_ids_preserved', introduced.length === 0,
      introduced.length ? `payload introduces ${introduced.length} element id(s) not in source: ${introduced.slice(0, 5).join(', ')}` : '')

    // 4. length anomaly per widget vs the source widget of the same id
    const srcById = new Map()
    for (const w of widgetTexts(srcEd)) srcById.set(w.id + '|' + w.key, w.text)
    const anomalies = []
    for (const w of widgetTexts(ed)) {
      const s = srcById.get(w.id + '|' + w.key)
      if (s == null) continue
      const isEditor = w.key === 'editor' || w.key === 'description_text'
      const capChars = isEditor ? 2000 : 200
      const capRatio = isEditor ? 3 : 4
      if (w.text.length > capChars || (s.length > 0 && w.text.length > s.length * capRatio)) {
        anomalies.push(`${w.id}.${w.key}: ${s.length}→${w.text.length}`)
      }
    }
    add('length_anomaly', anomalies.length === 0,
      anomalies.length ? `hallucination-scale growth (B6): ${anomalies.slice(0, 4).join('; ')}` : '')
  }

  // 5. wrong-language characters (run on DECODED text — B35e)
  if (isTranslation) {
    if (lang === 'es' || lang === 'fr') {
      // CJK that isn't also in the EN source (legit artifacts: IG embeds, filenames, zodiac-year chars)
      const bad = [...text].filter(ch => CJK_RX.test(ch) && !srcText.includes(ch))
      add('wrong_language_chars', bad.length === 0,
        bad.length ? `${bad.length} CJK char(s) in a ${lang} payload not present in source (B33/B35): ${[...new Set(bad)].slice(0, 8).join('')}` : '')
    } else if (lang === 'zh-hant') {
      const simp = new Set(SIMPLIFIED)
      const bad = [...text].filter(ch => simp.has(ch))
      add('wrong_language_chars', bad.length === 0,
        bad.length ? `simplified-Chinese form(s) in a zh-hant payload: ${[...new Set(bad)].slice(0, 12).join('')}` : '')
    } else if (lang === 'ja') {
      const simp = new Set(SIMPLIFIED)
      const bad = [...text].filter(ch => simp.has(ch) && !srcText.includes(ch))
      add('wrong_language_chars', bad.length === 0,
        bad.length ? `simplified-Chinese form(s) in a ja payload: ${[...new Set(bad)].slice(0, 12).join('')}` : '')
    }
  }

  // 6. placeholder / apology / untranslated markers (B12)
  const ph = text.match(PLACEHOLDER_RX)
  add('placeholder_markers', !ph, ph ? `contains "${ph[0]}"` : '')

  // 7. brand terms preserved (only meaningful when we have the source)
  if (source) {
    const dropped = BRAND_TERMS.filter(t => srcText.includes(t) && !text.includes(t))
    add('brand_terms_preserved', dropped.length === 0,
      dropped.length ? `brand term(s) translated away: ${dropped.join(', ')}` : '')
  }

  // 8. SKU / model prefix preserved on the name
  if (source && typeof payload.name === 'string' && typeof source.name === 'string') {
    const m = source.name.match(/^([A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*)[\s–-]/)
    if (m) add('sku_prefix_preserved', payload.name.startsWith(m[1]),
      payload.name.startsWith(m[1]) ? '' : `name should start with SKU "${m[1]}" — got "${payload.name.slice(0, 40)}"`)
  }

  // 9/10. image + heading count parity (HTML fields)
  if (source) {
    const pImg = countMatches(asString(payload.content) + asString(payload.description) + asString(payload.short_description), /<img[\s>]/gi)
    const sImg = countMatches(asString(source.content) + asString(source.description) + asString(source.short_description), /<img[\s>]/gi)
    if (sImg > 0) add('image_count_parity', pImg === sImg, pImg === sImg ? '' : `${pImg} <img> vs source ${sImg}`)

    const pH = countMatches(asString(payload.content) + asString(payload.description), /<h2[\s>]/gi)
    const sH = countMatches(asString(source.content) + asString(source.description), /<h2[\s>]/gi)
    if (sH > 0) add('heading_count_parity', pH === sH, pH === sH ? '' : `${pH} <h2> vs source ${sH}`)
  }

  // 11. no scripts/tables introduced
  const bodyStr = asString(payload.content) + asString(payload.description) + asString(payload.short_description) + asString(edRaw)
  const srcBodyStr = source ? asString(source.content) + asString(source.description) + asString(source.short_description) + asString(source?.meta?._elementor_data) : ''
  if (!source || !SCRIPT_RX.test(srcBodyStr)) add('no_new_scripts', !SCRIPT_RX.test(bodyStr), SCRIPT_RX.test(bodyStr) ? '<script> introduced' : '')
  if (!source || !TABLE_RX.test(srcBodyStr)) add('no_new_tables', !TABLE_RX.test(bodyStr), TABLE_RX.test(bodyStr) ? '<table> introduced' : '')

  // 12. Yoast title double-branding (L-09)
  const yt = payload?.meta?._yoast_wpseo_title
  if (typeof yt === 'string' && yt) {
    const doubled = /\|\s*crystocraft\s*$/i.test(yt) || /crystocraft\s*\|\s*crystocraft/i.test(yt)
    add('seo_title_no_double_brand', !doubled, doubled ? `title ends with "| Crystocraft" — Yoast appends the site name (L-09): "${yt}"` : '')
  }

  // 13. meta description length
  const yd = payload?.meta?._yoast_wpseo_metadesc
  if (typeof yd === 'string' && yd) add('seo_desc_length', yd.length <= 158, yd.length > 158 ? `${yd.length} chars (>158)` : '')

  // 14. an unlinked translation draft must NOT be published (Rule 4)
  if (isTranslation && /[?&]lang=/.test(endpoint) && /\/(posts|pages|products)(\?|$)/.test(endpoint)) {
    const pub = payload.status === 'publish' || payload.status === 'future'
    add('translation_draft_only', !pub, pub ? `creating a ${lang} translation with status:${payload.status} — must be draft until the trid is linked (Rule 4)` : '')
  }

  // 15. advisory — layout write needs a cache clear afterwards
  if (edRaw != null) add('elementor_cache_reminder', true, 'writes _elementor_data — element-cache clear + flush-css + host purge required after (Rule 5)')

  const passed = checks.every(c => c.ok !== false)
  return { passed, checks }
}

export default validatePayload
