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
//   wrong_language_chars ..... B33 / B35 (CJK leak in es/fr), simplified-in-zh-hant
//                              (B51/B53 trimmed 6 valid traditional forms),
//                              simplified-in-ja (B54 — ja uses its own
//                              Chinese-only list, not the zh-hant set)
//   placeholder_markers ...... B12; fr/ja/zh-hant coverage added L-29 (this
//                              repo's LESSONS-LEARNED.md) — was en/es/zh-hans
//                              only, missing 3 of the 6 languages this site
//                              actually publishes in
//   brand_terms_preserved .... §3c, §8b.5, B53 (ignore Yoast head + JSON-LD;
//                              source text is the RAW body, never `.rendered` —
//                              L-47)
//   sku_prefix_preserved ..... B12 (SKU-preserving name translation)
//   image_count_parity ....... §2 payload validation (RAW body on both sides)
//   heading_count_parity ..... §2 (RAW body on both sides — a live entity's
//                              `.rendered` is the built Elementor page and can
//                              never match a raw payload body; 2026-10-03)
//   no_new_scripts_or_tables . §2 (RAW body on both sides — `.rendered` carries
//                              Yoast's inline JSON-LD, which used to suppress
//                              the check entirely)
//
// The RAW-body rule is one rule, not three: `contentString()` is used by the
// three checks above AND by `payloadText()` (which feeds the language /
// placeholder / brand scans). An object field contributes `.raw` only, and an
// absent `.raw` means "no authored body — nothing to compare", so the check
// SKIPS rather than falling back to the render. Fixing it at only some call
// sites is how L-47 happened; when this class of bug appears, grep for the
// pattern rather than patching the site that was reported.
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

// zh-hant guard: simplified forms that must never appear in a zh-hant payload.
// From the Workbench's translate-product.mjs SIMPLIFIED set, minus six forms
// that are ALSO standard Traditional Chinese and were false-positiving on
// 舞台 / 回顧 / 平台 / 繁體 / 羨慕 / 山谷 (B51 / B53): 只 繁 慕 谷 回 台.
const SIMPLIFIED = '这钥转涡设语门观复个们么头车马鸟鱼龙龟无云电风东长儿见贝专业义书乐发亚为兰兴农军华区单卖卫历压厂严县参变叶号后页团园图国处备声实宝写对寻导寿将尔尘层属岁岂帐币帮广庄应庙废库开张弹强归当录径彻征从态怀总战忆忧怜恶恼恋恒恳悬惯懒戏积种红级结纪约纽纯纸纹线练组细终经统继续编缘维网纵纠购贡贫穷货质费账贵贺贷贸宾赞页顿预频颇领顾显题颜风飞饱饭饮养骄验体选锦钟铁银针锋铸镜闲间闻阅队阳阶际陆陈随隐难虽页颜题顾风飞马验'

// ja guard: a curated Chinese-ONLY list. The zh-hant SIMPLIFIED set above is
// ~90% valid Japanese kanji (国 台 宝 当 属 回 号 寿 写 声 将 强 红 级 结 约 …),
// so reusing it false-flagged every ja payload (B54). This list is the subset
// that is genuinely PRC-simplified and not standard Japanese.
const SIMPLIFIED_JA = '这们个为时说话马鸟鱼龙电东书农华单卖卫历压厂严县团园图处备实对寻导尔尘岁帐币帮广应庙库张弹归录彻从态怀忆忧怜恼恳悬惯懒戏积纽练组细网纵纠购贡穷货质费账贺贷贸宾赞页顿预频颇领顾显题颜飞饱饮养骄验选锦钟针锋铸闲阅陆陈隐难虽马验观复么头车'

const PLACEHOLDER_RX = /\b(please provide|translate this|as an ai|i cannot|i['’]m sorry|lorem ipsum|todo:)\b|请提供|请输入|需要翻译|\[placeholder\]/i
// "por favor" on its own is polite Spanish, NOT a marker — "por favor
// contáctenos" / "por favor complete el formulario" are common in real es
// copy (B51). Only flag it when it introduces a translator / AI instruction
// that leaked into the output ("Por favor, proporcione la traducción…").
// Optional punctuation is allowed between the two parts (comma fix).
const SPANISH_INSTRUCTION_RX = /\bpor favor[\s,.;:¡!¿?—–-]*(traduc|traduzc|proporcion|complet|rellen|introduzc|escrib(?:a|e|an)\b|redact|revis|provee|añad|inserta|reempl)/i
// L-29 (2026-09-23, Workbench handoff): PLACEHOLDER_RX had zero fr/ja
// coverage and zh-only simplified forms — 28 of 29 leaked translator-
// instruction excerpts sitewide could not have been caught by any check
// that existed before this. Same co-occurrence shape as SPANISH_INSTRUCTION_RX
// above: a request/imperative marker AND a translation stem, not either
// alone — a bare "veuillez indiquer" (checkout copy) or "請提供您的訂單編號"
// (a real form field) is ordinary commerce language, not a leak. A v1 draft
// that flagged the markers unconditionally caught all leaks but false-
// positived on exactly that kind of real copy.
const FRENCH_INSTRUCTION_RX = /(veuillez|merci de|fournir|fournissez|envoyer|envoyez|saisir|saisissez|coller|collez|indiquer|indiquez|transmettre|transmettez)\b[^.]{0,80}(traduire|traduisez|traduction|traduit|à traduire|a traduire)/i
const JAPANESE_INSTRUCTION_RX = /(翻訳する|翻訳の|訳す|翻訳したい)[^。]{0,20}(テキスト|文章|文)[^。]{0,10}(提供|入力|送信|貼り付け)|テキストを提供してください|翻訳してください|翻訳して(ください|下さい)/
// zh-hant is first-class on this site (52 published posts) but PLACEHOLDER_RX's
// 请提供/请输入/需要翻译 are simplified-only — their traditional forms
// (請提供/請輸入/需要翻譯) never matched. Gated on a translation term for the
// same reason as the fr/ja patterns above.
const TRADITIONAL_ZH_INSTRUCTION_RX = /(請提供|請輸入|請貼上)[^。]{0,20}(翻譯|譯文|譯)|需要翻譯|翻譯[^。]{0,15}(文字|內容|文本|資料)/
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
// decoded Elementor widget text). Used for the language / placeholder / brand
// scans — on BOTH sides (`text` = payload, `srcText` = source).
function payloadText(payload) {
  const parts = []
  for (const [k, v] of Object.entries(payload || {})) {
    // `meta` is walked selectively below. `yoast_head` / `yoast_head_json` are
    // Yoast's GENERATED head (og tags + JSON-LD) that WooCommerce echoes back
    // read-only — its `"name":"Crystocraft"` etc. was false-flagging
    // brand_terms_preserved and leaking stray chars into the language scan (B53).
    if (k === 'meta' || k === 'yoast_head' || k === 'yoast_head_json') continue
    if (typeof v === 'string') parts.push(v)
    // An object field is a REST `{ rendered, raw }` (a live entity's content /
    // excerpt / title). It MUST go through contentString so it contributes its
    // RAW body: `.rendered` is the whole built page, and counting it as source
    // text made `brand_terms_preserved` unsatisfiable — the render carries brand
    // names in image filenames, alt text and links that the payload body cannot
    // (2026-10-03 follow-up; same false-flag class as `yoast_head` above, L-47).
    else if (v && typeof v === 'object') parts.push(contentString(v))
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

// `content` is either a string (our payload) or the REST object
// `{ rendered, raw }` (a live entity). Compare like with like, and use RAW
// ONLY: `.rendered` is the BUILT page for an Elementor post — the entire page,
// with its own images, headings, brand-mentioning filenames/alt text and inline
// JSON-LD — which is not what a body-level check is about and can never equal a
// raw payload body (2026-10-03: every correct Elementor edit failed
// image/heading parity, 0 <img> vs source 36).
//
// An absent `.raw` returns '' — "no authored body, nothing to compare" — so the
// body-level checks SKIP rather than silently comparing against the render
// again. That matters: `wpEntity()` fetches without `context=edit`, which omits
// `.raw`, so a `.rendered` fallback here would quietly restore the old
// behaviour for every caller that forgot the parameter (L-47).
function contentString(c) {
  if (c == null) return ''
  if (typeof c === 'string') return c
  if (typeof c === 'object') return String(c.raw ?? '')
  return String(c)
}

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
      const simp = new Set(SIMPLIFIED_JA)
      const bad = [...text].filter(ch => simp.has(ch) && !srcText.includes(ch))
      add('wrong_language_chars', bad.length === 0,
        bad.length ? `simplified-Chinese form(s) in a ja payload: ${[...new Set(bad)].slice(0, 12).join('')}` : '')
    }
  }

  // 6. placeholder / apology / untranslated markers (B12); "por favor" only
  //    when it fronts a translator instruction (B51).
  const ph = text.match(PLACEHOLDER_RX) || text.match(SPANISH_INSTRUCTION_RX)
    || text.match(FRENCH_INSTRUCTION_RX) || text.match(JAPANESE_INSTRUCTION_RX)
    || text.match(TRADITIONAL_ZH_INSTRUCTION_RX)
  add('placeholder_markers', !ph, ph ? `contains "${ph[0]}"` : '')

  // 6b. Encoding damage. Scan the parsed Elementor value too: its raw JSON
  // may spell U+FFFD as "\\ufffd", which does not contain the character we
  // need to catch. Both halves of the surrogate-pair check matter: a malformed
  // string may contain an unpaired low surrogate as well as an unpaired high.
  const parsedElementor = edRaw != null && ed !== undefined ? JSON.stringify(ed) : ''
  const enc = [text, parsedElementor].join('\n')
  const damaged = /[\uFFFD]/.test(enc)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(enc)
    || /Ã[\u0080-\u00BF]|â€|ï¿½/.test(enc)
  add('no_encoding_damage', !damaged,
    damaged ? 'U+FFFD / lone surrogate / legacy mojibake in the payload' : '')

  // 7. brand terms preserved (only meaningful when we have the source).
  //    Compare on markup-free text: <script>/<style> bodies (JSON-LD in
  //    particular embeds "Crystocraft") and tags would otherwise make a brand
  //    term look "present in source" that no human-visible copy dropped (B53).
  if (source) {
    const bare = (s) => stripTags(String(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '))
    const srcBare = bare(srcText), payBare = bare(text)
    const dropped = BRAND_TERMS.filter(t => srcBare.includes(t) && !payBare.includes(t))
    add('brand_terms_preserved', dropped.length === 0,
      dropped.length ? `brand term(s) translated away: ${dropped.join(', ')}` : '')
  }

  // 8. SKU / model prefix preserved on the name
  if (source && typeof payload.name === 'string' && typeof source.name === 'string') {
    const m = source.name.match(/^([A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*)[\s–-]/)
    if (m) add('sku_prefix_preserved', payload.name.startsWith(m[1]),
      payload.name.startsWith(m[1]) ? '' : `name should start with SKU "${m[1]}" — got "${payload.name.slice(0, 40)}"`)
  }

  // 9/10. image + heading count parity (HTML fields). Both sides go through
  // contentString() so a live entity's REST `content` object is compared on its
  // RAW body, not its rendered page (see the helper).
  if (source) {
    const pBody = contentString(payload.content) + contentString(payload.description) + contentString(payload.short_description)
    const sBody = contentString(source.content) + contentString(source.description) + contentString(source.short_description)
    const pImg = countMatches(pBody, /<img[\s>]/gi)
    const sImg = countMatches(sBody, /<img[\s>]/gi)
    if (sImg > 0) add('image_count_parity', pImg === sImg, pImg === sImg ? '' : `${pImg} <img> vs source ${sImg}`)

    const pHEad = contentString(payload.content) + contentString(payload.description)
    const sHead = contentString(source.content) + contentString(source.description)
    const pH = countMatches(pHEad, /<h2[\s>]/gi)
    const sH = countMatches(sHead, /<h2[\s>]/gi)
    if (sH > 0) add('heading_count_parity', pH === sH, pH === sH ? '' : `${pH} <h2> vs source ${sH}`)
  }

  // 11. no scripts/tables introduced. Same raw-body rule: a source entity's
  // `.rendered` page carries Yoast's inline JSON-LD <script>, which used to
  // suppress this check entirely; and it can equally carry a <table> the raw
  // body never had.
  const bodyStr = contentString(payload.content) + contentString(payload.description) + contentString(payload.short_description) + asString(edRaw)
  const srcBodyStr = source ? contentString(source.content) + contentString(source.description) + contentString(source.short_description) + asString(source?.meta?._elementor_data) : ''
  if (!source || !SCRIPT_RX.test(srcBodyStr)) add('no_new_scripts', !SCRIPT_RX.test(bodyStr), SCRIPT_RX.test(bodyStr) ? '<script> introduced' : '')
  if (!source || !TABLE_RX.test(srcBodyStr)) add('no_new_tables', !TABLE_RX.test(bodyStr), TABLE_RX.test(bodyStr) ? '<table> introduced' : '')

  // 12. Yoast title double-branding (L-09). A custom Yoast title is emitted
  // verbatim; only the post-title path receives Yoast's site-name template.
  // Still reject a literal duplicate in either field.
  const yt = payload?.meta?._yoast_wpseo_title
  const pt = typeof payload?.title === 'string' ? payload.title : ''
  const DBL_RX = /crystocraft\s*[|\-–—]\s*crystocraft/i
  const branded = (s) => /crystocraft\s*$/i.test(String(s).trim())
  const doubled = DBL_RX.test(yt || '') || DBL_RX.test(pt)
    || ((!yt || !yt.trim()) && branded(pt))
  if (yt || pt) {
    add('seo_title_no_double_brand', !doubled,
      doubled ? `site name would be doubled (L-09): custom title ${JSON.stringify(yt || '')}, post title ${JSON.stringify(pt)}` : '')
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
