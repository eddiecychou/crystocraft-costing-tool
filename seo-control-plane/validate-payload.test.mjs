// node seo-control-plane/validate-payload.test.mjs
import { validatePayload, SIMPLIFIED } from './validate-payload.mjs'

let pass = 0, fail = 0
const chk = (v) => v.checks.reduce((m, c) => (m[c.name] = c.ok, m), {})
function expect(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── a clean ES product translation ───────────────────────────────────────
{
  const source = {
    name: 'D0268 Crystal Rose Figurine',
    description: '<h2>About</h2><p>A crystal rose <img src="a.jpg"/> gift.</p>',
    meta: { _elementor_data: JSON.stringify([{ id: 'a1', elType: 'widget', widgetType: 'heading', settings: { title: 'Colours and Effects' } }]) },
  }
  const payload = {
    name: 'D0268 Figura de Rosa de Cristal',
    description: '<h2>Acerca de</h2><p>Un regalo de rosa de cristal <img src="a.jpg"/>.</p>',
    meta: {
      _elementor_data: JSON.stringify([{ id: 'a1', elType: 'widget', widgetType: 'heading', settings: { title: 'Colores y efectos' } }]),
      _yoast_wpseo_title: 'Figura de Rosa de Cristal - Crystocraft',
      _yoast_wpseo_metadesc: 'Una figura de rosa de cristal, regalo corporativo elegante de Crystocraft.',
    },
    status: 'draft',
  }
  const v = validatePayload({ kind: 'product', lang: 'es', endpoint: 'wc/v3/products?lang=es', payload, source })
  expect('clean ES payload passes', v.passed, JSON.stringify(v.checks.filter(c => !c.ok)))
  const c = chk(v)
  expect('  widget_count ok', c.widget_count === true)
  expect('  brand preserved', c.brand_terms_preserved === true)
  expect('  image parity', c.image_count_parity === true)
}

// ── B6: length anomaly (short heading ballooned) ─────────────────────────
{
  const source = { meta: { _elementor_data: JSON.stringify([{ id: 'h1', elType: 'widget', widgetType: 'heading', settings: { title: 'IT Film' } }]) } }
  const payload = { meta: { _elementor_data: JSON.stringify([{ id: 'h1', elType: 'widget', widgetType: 'heading', settings: { title: 'IT Film '.repeat(200) } }]) } }
  const v = validatePayload({ kind: 'product', lang: 'zh-hant', payload, source })
  expect('B6 length anomaly caught', v.passed === false && chk(v).length_anomaly === false)
}

// ── B33/B35: CJK leaked into a FR payload ───────────────────────────────
{
  const source = { name: 'Crystal Horse' }
  const payload = { name: 'Cheval en cristal 水晶马', status: 'draft' }
  const v = validatePayload({ kind: 'product', lang: 'fr', payload, source })
  expect('B33 CJK-in-fr caught', v.passed === false && chk(v).wrong_language_chars === false)
}

// ── simplified char in a zh-hant payload ────────────────────────────────
{
  const payload = { name: '水晶马' } // 马 is simplified; 馬 is traditional
  const v = validatePayload({ kind: 'product', lang: 'zh-hant', payload })
  expect('simplified-in-zh-hant caught', v.passed === false && chk(v).wrong_language_chars === false)
}

// ── B12: placeholder marker ─────────────────────────────────────────────
{
  const v = validatePayload({ kind: 'product', lang: 'es', payload: { name: 'Por favor, proporcione el nombre del producto' } })
  expect('B12 placeholder caught', v.passed === false && chk(v).placeholder_markers === false)
}

// ── B51: polite "por favor" in real es copy must NOT flag ─────────────
{
  const v = validatePayload({ kind: 'page', lang: 'es',
    payload: { title: 'Contáctenos', content: '<p>Por favor, contáctenos para un presupuesto. Por favor visítenos en la feria.</p>', status: 'draft' } })
  expect('B51 polite por-favor passes', chk(v).placeholder_markers !== false,
    JSON.stringify(v.checks.filter(c => !c.ok)))
  // but a leaked translator instruction still trips it
  const v2 = validatePayload({ kind: 'page', lang: 'es', payload: { title: 'Por favor traduzca el siguiente texto' } })
  expect('B51 still catches "por favor traduzca"', v2.passed === false && chk(v2).placeholder_markers === false)
}

// ── L-09: double-branding lives on the post-title template path ─────────
{
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { title: 'Best Corporate Gifts | Crystocraft' } })
  expect('L-09 post title with brand caught', v.passed === false && chk(v).seo_title_no_double_brand === false)
}
{
  const v = validatePayload({ kind: 'post', lang: 'fr', payload: {
    title: 'Horoscope Capricorne 2026 : Prédictions et Conseils',
    meta: { _yoast_wpseo_title: 'Horoscope Capricorne 2026 : Prédictions et Conseils | Crystocraft' },
  } })
  expect('L-09 custom title with brand accepted', v.passed === true && chk(v).seo_title_no_double_brand === true)
}
{
  const v = validatePayload({ kind: 'post', lang: 'en', payload: {
    title: 'Corporate Gifts', meta: { _yoast_wpseo_title: 'Crystocraft | Crystocraft' },
  } })
  expect('L-09 literal duplicate custom title caught', v.passed === false && chk(v).seo_title_no_double_brand === false)
}

// ── Encoding damage: inspect decoded Elementor content, not raw JSON ────
{
  const payload = { meta: { _elementor_data: JSON.stringify([
    { id: 'e1', elType: 'widget', widgetType: 'text-editor', settings: { editor: 'Damaged replacement: \uFFFD' } },
  ]) } }
  const v = validatePayload({ kind: 'post', lang: 'ja', payload })
  expect('encoding replacement character in Elementor caught', v.passed === false && chk(v).no_encoding_damage === false)
}
{
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { title: `broken ${'\uDC00'}` } })
  expect('encoding lone low surrogate caught', v.passed === false && chk(v).no_encoding_damage === false)
}
{
  const v = validatePayload({ kind: 'post', lang: 'fr', payload: { title: 'Élégance française pour célébrer Noël' } })
  expect('ordinary accented copy has no encoding damage', chk(v).no_encoding_damage === true)
}

// ── Rule 4: publishing an unlinked translation ─────────────────────────
{
  const v = validatePayload({ kind: 'post', lang: 'ja', endpoint: 'wp/v2/posts?lang=ja', payload: { title: 'テスト', status: 'publish' } })
  expect('Rule 4 publish-translation caught', v.passed === false && chk(v).translation_draft_only === false)
}

// ── B20: stale layout (widget count mismatch) ─────────────────────────
{
  const mk = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: 'w' + i, elType: 'widget', widgetType: 'text-editor', settings: { editor: 'x' } })))
  const v = validatePayload({
    kind: 'page', lang: 'ja',
    payload: { meta: { _elementor_data: mk(16) } },
    source: { meta: { _elementor_data: mk(20) } },
  })
  expect('B20 stale-layout caught', v.passed === false && chk(v).widget_count === false)
}

// ── B53: Yoast head / JSON-LD must not drive brand_terms_preserved ─────
{
  // Source carries Yoast's generated head with "Crystocraft" in JSON-LD +
  // an inline JSON-LD <script> in the body; the ES payload legitimately
  // keeps "Crystocraft" in visible copy but not in those machine blocks.
  const source = {
    name: 'D0268 Crystocraft Crystal Rose',
    description: '<p>A Crystocraft gift.</p><script type="application/ld+json">{"@type":"Product","brand":"Crystocraft"}</script>',
    yoast_head_json: { og_site_name: 'Crystocraft', schema: { '@graph': [{ name: 'Crystocraft' }] } },
    yoast_head: '<meta property="og:site_name" content="Crystocraft"/>',
  }
  const payload = {
    name: 'D0268 Rosa de Cristal Crystocraft',
    description: '<p>Un regalo de Crystocraft.</p>',
    status: 'draft',
  }
  const v = validatePayload({ kind: 'product', lang: 'es', endpoint: 'wc/v3/products?lang=es', payload, source })
  expect('B53 Yoast/JSON-LD not counted for brand check', chk(v).brand_terms_preserved === true,
    JSON.stringify(v.checks.filter(c => !c.ok)))
}

// ── B51/B53: valid Traditional forms no longer flagged in zh-hant ──────
{
  // 舞台 (stage), 回顧 (review), 繁體 (traditional), 山谷 (valley), 羨慕 (envy)
  const v = validatePayload({ kind: 'page', lang: 'zh-hant', payload: { title: '舞台上的回顧：繁體字、山谷與羨慕' } })
  expect('zh-hant allows 台回繁谷慕', chk(v).wrong_language_chars !== false,
    JSON.stringify(v.checks.filter(c => !c.ok)))
  // but a genuine simplified form still trips it (这 个 门 are all PRC-simplified)
  const v2 = validatePayload({ kind: 'page', lang: 'zh-hant', payload: { title: '这个门' } })
  expect('zh-hant still catches 这个门', v2.passed === false && chk(v2).wrong_language_chars === false)
}

// ── B54: ja payload of normal Japanese kanji must pass ────────────────
{
  // All standard Japanese: 国 台 宝 当 号 写 声 将 会 図 実 対
  const v = validatePayload({ kind: 'post', lang: 'ja', endpoint: 'wp/v2/posts?lang=ja',
    payload: { title: '国宝級の台座と号数', content: '<p>会場の図と実物に対する声</p>', status: 'draft' } })
  expect('B54 normal ja kanji passes', chk(v).wrong_language_chars !== false,
    JSON.stringify(v.checks.filter(c => !c.ok)))
  // a PRC-only form still trips it
  const v2 = validatePayload({ kind: 'post', lang: 'ja', endpoint: 'wp/v2/posts?lang=ja',
    payload: { title: '这个说话', status: 'draft' } })
  expect('B54 still catches 这个说 in ja', v2.passed === false && chk(v2).wrong_language_chars === false)
}

// ── 2026-09-23 (Workbench handoff): fr/ja/zh-hant leaked-translator-
// instruction coverage — 28 of 29 sitewide leaks predated this check ──────
{
  const leaks = [
    ['fr', 'Veuillez fournir le texte à traduire.'],
    ['fr', 'Veuillez fournir le texte source à traduire.'],
    ['fr', 'Merci de traduire le paragraphe suivant.'],
    ['ja', '翻訳するテキストを提供してください。'],
    ['ja', '以下の文章を翻訳してください。'],
    ['ja', 'テキストを提供してください'],
    ['zh-hant', '請提供要翻譯的文字。'],
    ['zh-hant', '請輸入需要翻譯的內容'],
    ['zh-hant', '需要翻譯'],
  ]
  for (const [lang, title] of leaks) {
    const v = validatePayload({ kind: 'post', lang, endpoint: `wp/v2/posts?lang=${lang}`, payload: { title, status: 'draft' } })
    expect(`leak caught [${lang}] "${title}"`, v.passed === false && chk(v).placeholder_markers === false)
  }
}

// ── same set: real copy that must NOT fire (the false positives v1 produced) ──
{
  const clean = [
    ['fr', 'Veuillez indiquer votre adresse de livraison.'],
    ['fr', 'Veuillez saisir votre code promotionnel.'],
    ['fr', 'Veuillez noter que les délais peuvent varier.'],
    ['fr', 'La traduction de nos catalogues est disponible sur demande.'],
    ['zh-hant', '請提供您的訂單編號以便我們查詢。'],
    ['zh-hant', '請輸入您的電郵地址。'],
    ['zh-hant', '翻譯服務由專人負責，歡迎查詢。'],
    ['ja', 'Crystocraftのこのユニークなワインデキャンタが心温まる贈り物になります。'],
  ]
  for (const [lang, title] of clean) {
    const v = validatePayload({ kind: 'post', lang, endpoint: `wp/v2/posts?lang=${lang}`, payload: { title, status: 'draft' } })
    expect(`real copy passes [${lang}] "${title}"`, chk(v).placeholder_markers !== false,
      JSON.stringify(v.checks.filter(c => !c.ok)))
  }
}

// ── 2026-10-03: parity compares the RAW body, not the REST render ───────
// A live entity's `content` is `{ rendered, raw }`; for an Elementor post
// `.rendered` is the whole BUILT page (36 images, 4 <h2>) while the payload's
// raw body is a short paragraph. Comparing them could never agree, so every
// correct Elementor edit failed the gate.
{
  const rendered = '<h2>One</h2><h2>Two</h2><h2>Three</h2><h2>Four</h2>' + '<img src="a.jpg"/>'.repeat(36)
  const mkEd = (t) => JSON.stringify([{ id: 'a1', elType: 'widget', widgetType: 'heading', settings: { title: t } }])
  const source = {
    content: { rendered, raw: '<p>Short intro.</p>' },
    meta: { _elementor_data: mkEd('Old heading') },
  }
  const payload = { content: '<p>Short intro.</p>', meta: { _elementor_data: mkEd('Neue Überschrift') }, status: 'draft' }
  const v = validatePayload({ kind: 'page', lang: 'de', endpoint: 'wp/v2/pages?lang=de', payload, source })
  const c = chk(v)
  expect('Elementor edit: rendered side no longer drives image parity', c.image_count_parity === undefined,
    JSON.stringify(v.checks.filter(x => !x.ok)))
  expect('Elementor edit: rendered side no longer drives heading parity', c.heading_count_parity === undefined,
    JSON.stringify(v.checks.filter(x => !x.ok)))
  expect('Elementor edit passes on its own merits', v.passed, JSON.stringify(v.checks.filter(x => !x.ok)))
}

// ── the same check must still bite when the raw body REALLY has images ──
{
  const raw = '<p><img src="a.jpg"/><img src="b.jpg"/></p>'
  const source = { content: { rendered: raw, raw } }
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p><img src="a.jpg"/></p>', status: 'draft' }, source })
  expect('classic HTML body still enforces image parity', chk(v).image_count_parity === false,
    JSON.stringify(chk(v)))
}
{
  const raw = '<h2>About</h2><h2>Care</h2>'
  const source = { content: { rendered: raw, raw } }
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<h2>About</h2>', status: 'draft' }, source })
  expect('classic HTML body still enforces heading parity', chk(v).heading_count_parity === false,
    JSON.stringify(chk(v)))
}

// ── no_new_scripts/tables must read the raw body too ────────────────────
// Yoast's inline JSON-LD <script> lives in `.rendered`; it used to make the
// source side look script-bearing and suppress the check entirely.
{
  const source = { content: { rendered: '<p>ok</p><script type="application/ld+json">{}</script>', raw: '<p>ok</p>' } }
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p>ok</p><script>alert(1)</script>', status: 'draft' }, source })
  expect('no_new_scripts compares the raw body', chk(v).no_new_scripts === false, JSON.stringify(chk(v)))

  const v2 = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p>ok</p>', status: 'draft' }, source })
  expect('a clean body passes when the render carries JSON-LD', chk(v2).no_new_scripts === true, JSON.stringify(chk(v2)))

  const source2 = { content: { rendered: '<p>ok</p>', raw: '<p>ok</p><script>x</script>' } }
  const v3 = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p>ok</p><script>x</script>', status: 'draft' }, source: source2 })
  expect('a script already in the raw source is skipped, not flagged', chk(v3).no_new_scripts !== false, JSON.stringify(chk(v3)))

  const source3 = { content: { rendered: '<p>ok</p><table><tr><td>x</td></tr></table>', raw: '<p>ok</p>' } }
  const v4 = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p>ok</p><table><tr><td>y</td></tr></table>', status: 'draft' }, source: source3 })
  expect('no_new_tables compares the raw body', chk(v4).no_new_tables === false, JSON.stringify(chk(v4)))
}

// ── 2026-10-03 FOLLOW-UP (DSH): the render is not source TEXT either ────
// payloadText()'s object branch resolved `content` to `.rendered` — the whole
// built page, whose visible text the payload body does not carry. The source
// then always looked richer than the payload, so `brand_terms_preserved` could
// never pass for an Elementor edit that carried a complete source. Same root
// cause as the parity checks, fourth call site (L-47).
{
  const rendered = '<p>Intro.</p><h3>Swarovski crystal rose</h3><a href="/c">MagSafe charger</a>'
  const mkEd = (t) => JSON.stringify([{ id: 'w1', elType: 'widget', widgetType: 'text-editor', settings: { editor: t } }])
  const source = { content: { rendered, raw: '<p>Intro.</p>' }, meta: { _elementor_data: mkEd('A gift for every occasion.') } }
  const payload = { content: '<p>Intro.</p>', meta: { _elementor_data: mkEd('A gift for every occasion.') }, status: 'draft' }
  const v = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant', payload, source })
  expect('brand terms in the RENDER are not source text', chk(v).brand_terms_preserved === true,
    JSON.stringify(v.checks.filter(c => !c.ok)))
}

// ── an absent `.raw` means "nothing to compare", so the checks SKIP ─────
// `wpEntity()` fetches without `context=edit`, which omits `.raw`; a
// `.rendered` fallback in contentString() quietly restored the old behaviour
// for every caller that forgot the parameter (L-47).
{
  const source = { content: { rendered: '<img src="a.jpg"/>'.repeat(36) + '<h2>x</h2>'.repeat(4) } }
  const payload = { content: '<p>Intro.</p>', status: 'draft' }
  const v = validatePayload({ kind: 'page', lang: 'en', payload, source })
  const c = chk(v)
  // Present but explicitly SKIPPED (ok:null) — never silently absent, and never
  // compared against the render (L-48).
  expect('source without .raw: image parity skipped, not absent', c.image_count_parity === null, JSON.stringify(v.checks))
  expect('source without .raw: heading parity skipped, not absent', c.heading_count_parity === null, JSON.stringify(v.checks))
  expect('source without .raw: the pass is counted as partial', v.passed === true && v.skipped >= 4 && v.ran + v.skipped === v.checks.length,
    JSON.stringify({ ran: v.ran, skipped: v.skipped }))
}
{
  const v = validatePayload({ kind: 'page', lang: 'en',
    payload: { content: '<p>Intro.</p>', status: 'draft' },
    source: { content: { rendered: '<h3>Swarovski</h3>' } } })
  expect('source without .raw: no brand evidence from the render', chk(v).brand_terms_preserved === true,
    JSON.stringify(v.checks.filter(c => !c.ok)))
}

// ── the language scan's source-side excuse set comes from `.raw` too ────
{
  const v = validatePayload({ kind: 'post', lang: 'fr',
    payload: { title: 'Bonjour 水晶' },
    source: { content: { rendered: '<p>水晶</p>', raw: '<p>Hello</p>' } } })
  expect('CJK in the render alone no longer excuses a leak', chk(v).wrong_language_chars === false,
    JSON.stringify(chk(v)))

  const v2 = validatePayload({ kind: 'post', lang: 'fr',
    payload: { title: 'Bonjour 水晶' },
    source: { content: { rendered: '<p>Hello</p>', raw: '<p>水晶</p>' } } })
  expect('CJK in the raw source is still excused', chk(v2).wrong_language_chars === true,
    JSON.stringify(chk(v2)))
}

// ── 2026-10-03 SECOND FOLLOW-UP (DSH): the shape asymmetry (L-48) ───────
// `payload` is NESTED (`meta: { _elementor_data }`); the `before` snapshot is
// FLAT (`'meta._elementor_data'`). A flat entity used as the source used to
// (a) disable the three _elementor_data guards, because
// `parseElementor(source?.meta?._elementor_data)` found nothing, and (b) have
// its whole Elementor JSON pushed as source TEXT, because payloadText skipped
// the key `meta` but not `meta._elementor_data`. The OC's authoritative gate
// therefore ran a reduced check set AND blocked a correct edit.
{
  const widget = { id: 'w1', elType: 'widget', widgetType: 'text-editor', settings: { editor: 'A gift for every occasion.' } }
  // Brand terms live in CONTAINER settings / image metadata — which widgetTexts
  // correctly excludes. Only the raw-JSON string leak used to pull them in.
  const container = { id: 'c1', elType: 'container', settings: {
    background_image: { url: '/assets/crystal-rose.jpg', alt: 'Swarovski crystal rose' },
    link: { url: '/collections/magsafe', custom_text: 'MagSafe charger' },
  } }
  const tree = JSON.stringify([container, widget])
  const payload = { content: '<p>Intro.</p>', meta: { _elementor_data: tree, _yoast_wpseo_title: 'Crystal Rose' }, status: 'draft' }
  const before = { content: { rendered: '<p>Intro.</p><h3>Swarovski</h3>', raw: '<p>Intro.</p>' },
    'meta._elementor_data': tree, 'meta._yoast_wpseo_title': 'Crystal Rose' }

  const v = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant', payload, source: before })
  const c = chk(v)
  expect('flat before: structural guards RUN (widget_count)', c.widget_count === true, JSON.stringify(c))
  expect('flat before: structural guards RUN (element_ids_preserved)', c.element_ids_preserved === true, JSON.stringify(c))
  expect('flat before: structural guards RUN (length_anomaly)', c.length_anomaly === true, JSON.stringify(c))
  expect('flat before: brand terms in container settings are not source text', c.brand_terms_preserved === true,
    JSON.stringify(v.checks.filter(x => x.ok === false)))
  expect('flat before: the whole gate passes', v.passed === true, JSON.stringify(v.checks.filter(x => x.ok === false)))
}

// ── a layout write with no usable source tree FAILS, it does not skip ───
// These three ARE the B20/B6 protection for an _elementor_data write, so
// "could not run" is a failure — an unguarded layout write is the thing they
// exist to stop. (A flat `before` no longer lands here: it is normalised.)
{
  const tree = JSON.stringify([{ id: 'w1', elType: 'widget', widgetType: 'text-editor', settings: { editor: 'x' } }])
  const payload = { content: '<p>Intro.</p>', meta: { _elementor_data: tree }, status: 'draft' }

  const noSource = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant', payload })
  const cn = chk(noSource)
  expect('layout write, no source: widget_count FAILS with a reason', cn.widget_count === false, JSON.stringify(cn))
  expect('layout write, no source: detail says why', /MUST carry .source./.test(noSource.checks.find(x => x.name === 'widget_count').detail))
  expect('layout write, no source: gate blocked', noSource.passed === false)

  // A flat before WITHOUT the elementor key is still unusable — and says so.
  const flatNoTree = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant', payload,
    source: { content: { rendered: '<p>x</p>', raw: '<p>x</p>' }, 'meta._yoast_wpseo_title': 'X' } })
  expect('layout write, source without a tree: still blocked', chk(flatNoTree).widget_count === false,
    JSON.stringify(chk(flatNoTree)))

  // A classic HTML payload (no _elementor_data) is untouched by this rule.
  const classic = validatePayload({ kind: 'post', lang: 'en',
    payload: { content: '<p>Hello</p>', status: 'draft' }, source: { content: { rendered: '<p>Hello</p>', raw: '<p>Hello</p>' } } })
  expect('classic HTML write is not blocked', classic.passed === true, JSON.stringify(classic.checks.filter(x => x.ok === false)))
}

// ── no source at all: the source-dependent checks are LISTED, not absent ──
{
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { title: 'Hello', content: '<p>Hi</p>', status: 'draft' } })
  const c = chk(v)
  expect('no source: brand_terms_preserved listed as skipped', c.brand_terms_preserved === null)
  expect('no source: image_count_parity listed as skipped', c.image_count_parity === null)
  expect('no source: skipped > 0 makes the partial pass visible', v.passed === true && v.skipped >= 4,
    JSON.stringify({ ran: v.ran, skipped: v.skipped }))
}

// ── a source body without .raw must not false-fail the script check ────
// Before the skip existed, a classic post whose source was fetched without
// `context=edit` had srcBodyStr missing the source body, so a script present in
// BOTH sides looked newly introduced.
{
  const html = '<p>ok</p><script>legacy()</script>'
  const v = validatePayload({ kind: 'post', lang: 'en',
    payload: { content: html, status: 'draft' },
    source: { content: { rendered: html } } })   // no .raw
  expect('source without .raw: no_new_scripts skips instead of false-failing', chk(v).no_new_scripts === null,
    JSON.stringify(v.checks.filter(x => x.ok === false)))
  expect('source without .raw: gate not blocked by it', v.passed === true)
}

// ── a pre-existing script/table is a skip, not a silent absence ─────────
{
  const v = validatePayload({ kind: 'post', lang: 'en',
    payload: { content: '<p>ok</p><script>x</script>', status: 'draft' },
    source: { content: { rendered: '<p>ok</p><script>x</script>', raw: '<p>ok</p><script>x</script>' } } })
  const sk = v.checks.find(x => x.name === 'no_new_scripts')
  expect('pre-existing script: listed as skipped with a reason', sk && sk.ok === null && /already contains/.test(sk.detail),
    JSON.stringify(v.checks))
}

// ── L-49: the zh-hant guard is DERIVED from OpenCC, not hand-picked ─────
// The hand-curated 193-character list it replaced covered 4.9% of the real set
// and contained seven characters that are valid Traditional. Both halves of
// that are regressions worth pinning.
{
  expect('guard has 3,803 code points', [...SIMPLIFIED].length === 3803, String([...SIMPLIFIED].length))
  expect('guard has no duplicates', new Set([...SIMPLIFIED]).size === 3803)

  // covered now, missed by the 193-char list — incl. 訂製 / 禮品, the two
  // likeliest slips in a corporate-gift vocabulary
  for (const s of '订礼记师员务学爱给会时关') {
    expect(`guard covers ${s}`, SIMPLIFIED.includes(s))
  }
  const v1 = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant',
    payload: { title: '订制礼品', status: 'draft' } })
  expect('zh-hant catches 订制礼品 (訂製/禮品 in Simplified)', chk(v1).wrong_language_chars === false, JSON.stringify(chk(v1)))
  const ok1 = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant',
    payload: { title: '訂製禮品', status: 'draft' } })
  expect('zh-hant passes 訂製禮品', chk(ok1).wrong_language_chars === true, JSON.stringify(ok1.checks.filter(c => c.ok === false)))

  // the seven the old list rejected — all on OpenCC's traditional side, so all
  // ambiguous and excluded: 皇后 (后), 征戰 (征), 种氏 (种, a surname), 云云 (云),
  // and the radicals 厂 / 广 / 叶.
  for (const s of '云厂叶后广征种') {
    expect(`guard does NOT reject ${s} (valid Traditional)`, !SIMPLIFIED.includes(s))
  }
  const v2 = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant',
    payload: { title: '皇后親征　种氏云云　厂广叶', status: 'draft' } })
  expect('zh-hant passes text using 后/征/种/云/厂/广/叶', chk(v2).wrong_language_chars === true,
    JSON.stringify(v2.checks.filter(c => c.ok === false)))

  // the previously special-cased six need no exemption any more — the derivation
  // excludes them automatically
  for (const s of '只繁慕谷回台') {
    expect(`guard excludes ${s} (ambiguous)`, !SIMPLIFIED.includes(s))
  }

  // the site-wide footer slip: 户 in 客户服務, on every Chinese page
  const v3 = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant',
    payload: { title: '客户服務', status: 'draft' } })
  expect('zh-hant catches 客户服務 (户 -> 戶)', chk(v3).wrong_language_chars === false, JSON.stringify(chk(v3)))
  const ok3 = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant',
    payload: { title: '客戶服務', status: 'draft' } })
  expect('zh-hant passes 客戶服務', chk(ok3).wrong_language_chars === true)

  // CJK Extension-B (astral) — 1,141 of the guard's characters are U+20000+.
  // Iterating by UTF-16 unit instead of code point would drop all of them.
  expect('guard covers an Extension-B character', SIMPLIFIED.includes('\u{2003E}'))
  const v4 = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant',
    payload: { title: '\u{2003E}', status: 'draft' } })
  expect('zh-hant catches an Extension-B simplified character', chk(v4).wrong_language_chars === false, JSON.stringify(chk(v4)))
  const ok4 = validatePayload({ kind: 'page', lang: 'zh-hant', endpoint: 'wp/v2/pages/1?lang=zh-hant',
    payload: { title: '\u{20000}', status: 'draft' } })
  expect('zh-hant does not flag an Extension-B character outside the guard', chk(ok4).wrong_language_chars === true,
    JSON.stringify(chk(ok4)))
}

// ── 2026-10-03: WooCommerce products carry meta as a LIST ───────────────
// `meta_data: [{ key, value }]` — not `meta: { _elementor_data }`. Reading only
// the nested object made a product payload look textless: brand terms all
// "dropped", and the three _elementor_data guards absent for exactly the writes
// that most need them.
{
  const widget = { id: 'w1', elType: 'widget', widgetType: 'text-editor', settings: { editor: 'A gift for every occasion.' } }
  const container = { id: 'c1', elType: 'container', settings: { alt: 'Swarovski crystal rose' } }
  const tree = JSON.stringify([container, widget])
  const wcList = {
    name: 'D0268 Crystal Rose', description: '<p>A gift.</p>',
    meta_data: [
      { id: 1, key: '_elementor_data', value: tree },
      { id: 2, key: '_yoast_wpseo_title', value: 'Crystal Rose' },
      { id: 3, key: '_yoast_wpseo_metadesc', value: 'A crystal rose gift from Crystocraft.' },
    ],
  }
  // The reported shape: a WC payload against a nested-meta source.
  const nestedSource = {
    name: 'D0268 Crystal Rose', description: '<p>A gift.</p>',
    meta: { _elementor_data: tree, _yoast_wpseo_title: 'Crystal Rose', _yoast_wpseo_metadesc: 'A crystal rose gift from Crystocraft.' },
  }
  const v = validatePayload({ kind: 'product', lang: 'zh-hant', endpoint: 'wc/v3/products/53987?lang=zh-hant', payload: wcList, source: nestedSource })
  const c = chk(v)
  expect('WC meta_data: json_parses runs', c.json_parses === true, JSON.stringify(v.checks))
  expect('WC meta_data: widget_count runs', c.widget_count === true, JSON.stringify(c))
  expect('WC meta_data: element_ids_preserved runs', c.element_ids_preserved === true, JSON.stringify(c))
  expect('WC meta_data: length_anomaly runs', c.length_anomaly === true, JSON.stringify(c))
  expect('WC meta_data: brand terms read from the list, none falsely dropped', c.brand_terms_preserved === true,
    JSON.stringify(v.checks.filter(x => x.ok === false)))
  expect('WC meta_data: the Yoast title is read from the list', c.seo_title_no_double_brand === true)
  expect('WC meta_data: the metadesc length check runs', c.seo_desc_length === true)
  expect('WC meta_data: the whole gate passes, nothing skipped', v.passed === true && v.skipped === 0,
    JSON.stringify(v.checks.filter(x => x.ok === false)))

  const v2 = validatePayload({ kind: 'product', lang: 'zh-hant', endpoint: 'wc/v3/products/53987?lang=zh-hant', payload: wcList, source: wcList })
  expect('WC on both sides: structural guards run', chk(v2).widget_count === true && v2.passed === true,
    JSON.stringify(v2.checks.filter(x => x.ok === false)))

  // Precedence: an explicit nested `meta` beats a carrier `meta_data`.
  const both = { ...wcList, meta: { _elementor_data: JSON.stringify([{ id: 'x9', elType: 'widget', widgetType: 'heading', settings: { title: 'From meta' } }]) } }
  const v3 = validatePayload({ kind: 'product', lang: 'zh-hant', endpoint: 'wc/v3/products/53987?lang=zh-hant', payload: both, source: nestedSource })
  // The nested tree's element id (x9) is not in the source; the meta_data tree's
  // ids WOULD have been preserved. So a false here proves the nested tree won.
  expect('nested meta wins over meta_data', chk(v3).element_ids_preserved === false, JSON.stringify(chk(v3)))
}

// ── an INCOMPLETE source must skip, not run and lie ─────────────────────
// DSH's `before` carried only `_elementor_data`, so the source side of
// no_new_tables was empty and a page's EXISTING <table> was reported as newly
// introduced. A source that is present but incomplete is worse than none.
{
  const tree = JSON.stringify([{ id: 'w1', elType: 'widget', widgetType: 'text-editor', settings: { editor: 'x' } }])
  const v = validatePayload({
    kind: 'page', lang: 'en', endpoint: 'wp/v2/pages/1',
    payload: { content: '<p>Intro</p><table><tr><td>long-standing</td></tr></table>', status: 'draft' },
    source: { meta: { _elementor_data: tree } },
  })
  const c = chk(v)
  expect('incomplete source: no_new_tables skips', c.no_new_tables === null, JSON.stringify(c))
  expect('incomplete source: no_new_scripts skips', c.no_new_scripts === null)
  expect('incomplete source: parity skips', c.image_count_parity === null && c.heading_count_parity === null)
  expect('incomplete source: gate is not blocked by it', v.passed === true, JSON.stringify(v.checks.filter(x => x.ok === false)))
  expect('incomplete source: the partial pass is visible', v.skipped >= 4, JSON.stringify({ ran: v.ran, skipped: v.skipped }))
}

// The same class, unreported until now: a meta-only write against a source whose
// body has images used to report an image wipe (`0 <img> vs source 2`).
{
  const v = validatePayload({
    kind: 'page', lang: 'en', endpoint: 'wp/v2/pages/1',
    payload: { meta: { _yoast_wpseo_title: 'New title' }, status: 'draft' },
    source: { content: { rendered: '<p>x</p>', raw: '<p>x</p><img src="a.jpg"/><img src="b.jpg"/>' } },
  })
  expect('meta-only write: parity skips instead of reporting a wipe', chk(v).image_count_parity === null,
    JSON.stringify(v.checks.filter(x => x.ok === false)))
  expect('meta-only write: gate passes', v.passed === true)
}

// …while a real wipe, where BOTH sides carry the body, is still caught.
{
  const wipe = validatePayload({
    kind: 'post', lang: 'en', endpoint: 'wp/v2/posts/1',
    payload: { content: '<p>kept</p>', status: 'draft' },
    source: { content: { rendered: '<p>x</p>', raw: '<p>kept</p><img src="a.jpg"/><img src="b.jpg"/>' } },
  })
  expect('a real image wipe is still caught', chk(wipe).image_count_parity === false, JSON.stringify(chk(wipe)))
  const script = validatePayload({
    kind: 'post', lang: 'en', endpoint: 'wp/v2/posts/1',
    payload: { content: '<p>kept</p><script>track()</script>', status: 'draft' },
    source: { content: { rendered: '<p>kept</p>', raw: '<p>kept</p>' } },
  })
  expect('a newly introduced script is still caught', chk(script).no_new_scripts === false, JSON.stringify(chk(script)))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
