import { Document, Page, View, Text, Image, Font, StyleSheet, Svg, Defs, LinearGradient, Stop, Rect } from '@react-pdf/renderer'
import logoUrl from '../assets/logo.png'
import QuestrialRegular from '../assets/fonts/Questrial-Regular.ttf'
import WorkSansRegular  from '../assets/fonts/WorkSans-Regular.ttf'
import WorkSansMedium   from '../assets/fonts/WorkSans-Medium.ttf'
import WorkSansSemiBold from '../assets/fonts/WorkSans-SemiBold.ttf'

// Landscape client brand-proposal PDF (V8.10) — a CURATED SALES DOCUMENT,
// deliberately not a paginated screenshot of the customer portal grid. The
// portal (BrandPortalPage.jsx) is a browsing workspace: responsive CSS grid,
// filters, click-through detail pages. A PDF has none of that — it's read
// once, often by someone who never opens the portal at all — so this file
// has its own layout logic end to end, adaptive to how many products are in
// each section rather than forcing every section through one fixed grid.
// See PROJECT-PLAN.md's V8.10 entry for the full design brief this
// implements (owner's spec, 2026-08-24).
//
// Base tokens below are translated from `Crystocraft Design System V2.5/
// tokens/*.css` (colours/typography/spacing) — the authoritative source for
// "the existing Crystocraft design system" per that brief. Deliberately kept
// NEUTRAL here: no customer-specific brand colour is hardcoded into this
// file. `accentColor` is the one customer-specific knob, passed as a prop
// from the caller (defaults to the Gifts-division bronze, the most generic
// choice for a corporate-gift proposal) — never baked in as a constant.

Font.register({ family: 'Questrial', src: QuestrialRegular })
Font.register({ family: 'Work Sans', fonts: [
  { src: WorkSansRegular,  fontWeight: 400 },
  { src: WorkSansMedium,   fontWeight: 500 },
  { src: WorkSansSemiBold, fontWeight: 600 },
] })
Font.registerHyphenationCallback(w => [w])

// DS V2.5 tokens/colors.css, translated 1:1 (hex values, since react-pdf
// doesn't read CSS custom properties). Kept separate from the app's Tailwind
// theme on purpose — this PDF is the one place asked to follow the NEW
// design system rather than the app's own existing (older) brand-page CSS.
export const DS_COLORS = {
  nearBlack: '#222222',
  inkBlack: '#1C1C1A',   // cover / dark surfaces
  midGrey: '#666666',
  warmGrey: '#E9E8E6',   // hairline / card borders
  beige: '#F7EEE3',
  white: '#FFFFFF',
  champagne: '#C6A664',
  platinum: '#C9CBCC',
  // Division accents — the ONLY thing that varies by division in the real
  // design system. 'gifts' is the sane default for a corporate-gift
  // proposal; a caller may pass a different one via `division`.
  bronze: '#996632', bronzeLight: '#F4EDE5',
  sapphire: '#1C4F64', sapphireLight: '#E8EFF1',
  burgundy: '#6E2433', burgundyLight: '#F3E9EB',
}
const DIVISION_ACCENT = { gifts: DS_COLORS.bronze, crystals: DS_COLORS.sapphire, bespoke: DS_COLORS.burgundy }

// 16:9, sized generously for screen/email viewing per the brief ("Prefer
// 16:9 landscape for screen and email viewing") — 960x540pt renders crisp
// at typical screen zoom without the huge file size a print-resolution page
// would carry, and every browser/PDF viewer treats it as a normal page.
const PAGE = [960, 540]
const MARGIN = 48 // the page "safe area" every element must stay inside

const s = StyleSheet.create({
  page: { padding: MARGIN, fontFamily: 'Questrial', color: DS_COLORS.nearBlack, fontSize: 10 },

  // ── Cover — full-bleed hero + structured text block, never a short image
  // stacked over empty space (explicit brief requirement). ──
  coverPage: { padding: 0, fontFamily: 'Questrial' },
  coverImage: { position: 'absolute', top: 0, left: 0, width: PAGE[0], height: PAGE[1], objectFit: 'cover' },
  // A real linear gradient (react-pdf supports SVG gradients, just not CSS
  // ones) — a first attempt approximated this with stacked flat-opacity
  // bands, which looked fine against a flat grey QA placeholder but showed
  // visible horizontal stripes against a real photo (owner report,
  // 2026-08-24, with the actual generated PDF attached). An SVG
  // <LinearGradient> is the correct tool for this and has no seams.
  coverScrimSvg: { position: 'absolute', top: 0, left: 0 },
  coverContent: { position: 'absolute', left: MARGIN, right: MARGIN, bottom: MARGIN, top: MARGIN, justifyContent: 'space-between' },
  coverLogo: { width: 140, height: Math.round(140 / 5.713) },
  coverEyebrow: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: DS_COLORS.champagne, marginBottom: 10 },
  coverTitle: { fontSize: 42, color: DS_COLORS.white, lineHeight: 1.15, maxWidth: 640 },
  coverTagline: { fontSize: 13, color: DS_COLORS.white, opacity: 0.85, marginTop: 14, maxWidth: 520, lineHeight: 1.5 },
  coverMetaRow: { flexDirection: 'row', gap: 40 },
  coverMetaLabel: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 8, letterSpacing: 1.2, textTransform: 'uppercase', color: DS_COLORS.platinum, marginBottom: 3 },
  coverMetaValue: { fontSize: 11, color: DS_COLORS.white },

  // ── Section page chrome ──
  // No top header at all any more — owner, 2026-08-24: the logo sitting
  // directly above the section title read as "tightly squeezed together",
  // and "Prepared for X" (headMeta) was redundant with the cover. The logo
  // now lives bottom-right in the footer instead, and the title gets the
  // page's own top margin as real breathing room rather than sharing it
  // with a header bar.
  footer: { position: 'absolute', bottom: 20, left: MARGIN, right: MARGIN, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 0.8, borderTopColor: DS_COLORS.warmGrey, paddingTop: 8 },
  footText: { fontFamily: 'Work Sans', fontSize: 7, color: DS_COLORS.midGrey },
  footRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footLogo: { width: 52, height: Math.round(52 / 5.713) },

  sectionEyebrow: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 9, letterSpacing: 1.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 4 },
  // More generous spacing throughout — owner, 2026-08-24: "texts desc with
  // title are very squeezed and need some proper spacing".
  sectionTitle: { fontSize: 24, color: DS_COLORS.nearBlack, marginBottom: 8 },
  sectionTagline: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 11, color: DS_COLORS.midGrey, marginBottom: 10 },
  sectionBriefing: { fontSize: 10, color: DS_COLORS.midGrey, lineHeight: 1.55, maxWidth: 640, marginBottom: 26 },

  // ── Product card — image, name, ONE caption line, optional tag. No specs/
  // MOQ/supplier/lead time anywhere on these pages, per the brief. ──
  cardBorder: { borderWidth: 1, borderColor: DS_COLORS.warmGrey },
  // Square, always — owner report against the real generated PDF,
  // 2026-08-24: a fixed pixel HEIGHT paired with a percentage WIDTH (the
  // original approach) produced a different aspect ratio per tier and
  // cropped real product photos oddly. aspectRatio:1 derives the height
  // from whatever width the grid gives this card, so the frame is
  // consistently square regardless of column count — a "consistent image
  // frame" per the brief, not a coincidentally-similar one.
  cardImageWrap: { backgroundColor: DS_COLORS.beige, overflow: 'hidden', aspectRatio: 1 },
  cardImage: { width: '100%', height: '100%', objectFit: 'cover' },
  cardBody: { paddingTop: 8, paddingHorizontal: 2 },
  cardName: { fontSize: 10.5, color: DS_COLORS.nearBlack, marginBottom: 3 },
  cardCaption: { fontFamily: 'Work Sans', fontSize: 8, color: DS_COLORS.midGrey, lineHeight: 1.35 },
  cardTag: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 6.5, letterSpacing: 0.6, textTransform: 'uppercase', paddingVertical: 3, paddingHorizontal: 7, alignSelf: 'flex-start', marginBottom: 6 },

  // ── Solo / duo feature layouts (1–2 products) — square images, same as
  // the grid cards (see cardImageWrap's own comment: owner reported EVERY
  // product photo should be square, including the single-item feature
  // page, not just grid cards). Deliberately NO flex:1 anywhere in this
  // file for sizing (see ProductCard/FeatureSolo's own comments) —
  // RangeCataloguePDF.jsx already documents why: react-pdf's yoga layout
  // doesn't reliably compute a flex-grown block's height the way CSS
  // flexbox does, and a flex:1 child with no unambiguous available
  // dimension collapses to zero rather than filling space. Every block
  // here gets an EXPLICIT size instead. ──
  featureRow: { flexDirection: 'row', gap: 32, alignItems: 'center' },
  featureImageWrap: { backgroundColor: DS_COLORS.beige, overflow: 'hidden', aspectRatio: 1 },
  featureImage: { width: '100%', height: '100%', objectFit: 'cover' },
  featureText: { justifyContent: 'center' },
  featureName: { fontSize: 22, color: DS_COLORS.nearBlack, marginBottom: 8 },
  featureCaption: { fontFamily: 'Work Sans', fontSize: 10.5, color: DS_COLORS.midGrey, lineHeight: 1.5, maxWidth: 300 },
})

// ── Adaptive tiering — the whole point of this file. Never one fixed grid.
// Capped at 3 items per page (owner, 2026-08-24, after seeing the 4/8-up
// grids look "very strange" and cramped on a 16:9 page: "I think it is
// better to keep 1-3 max items in 1 page for this landscape"). No more
// 2x2/4x2 multi-row grids — every page is a single row of at most 3. ──
const MAX_PER_PAGE = 3
function tierFor(count) {
  if (count <= 1) return 'solo'
  if (count === 2) return 'duo'
  return 'triple' // 3, or the last chunk of a paginated group
}

// Anything beyond MAX_PER_PAGE splits across pages rather than shrinking
// cards or stacking rows — a 7-item section becomes three pages (3+3+1),
// the trailing single still getting its own full solo treatment rather
// than a lonely small card.
function paginate(products) {
  if (products.length <= MAX_PER_PAGE) return [products]
  const pages = []
  for (let i = 0; i < products.length; i += MAX_PER_PAGE) pages.push(products.slice(i, i + MAX_PER_PAGE))
  return pages
}

function Tag({ children, accent }) {
  if (!children) return null
  return <Text style={[s.cardTag, { color: accent, backgroundColor: accent + '14', borderWidth: 1, borderColor: accent + '33' }]}>{children}</Text>
}

function ProductCard({ p, accent }) {
  // No flex:1 wrapper — see the style block's own comment above. This is
  // the exact bug RangeCataloguePDF.jsx's ProductCard comment already
  // warns about, reintroduced and caught live by rendering every tier
  // before shipping (owner's own QA requirement): a flex:1 root here, nested
  // inside a plain-width column, collapsed every grid card's image to
  // nothing and overlapped every row of text.
  return (
    <View>
      <View style={[s.cardImageWrap, s.cardBorder]}>
        {p.image ? <Image style={s.cardImage} src={p.image} /> : null}
      </View>
      <View style={s.cardBody}>
        {p.tag ? <View style={{ marginTop: 6 }}><Tag accent={accent}>{p.tag}</Tag></View> : null}
        <Text style={s.cardName}>{p.name}</Text>
        {p.caption ? <Text style={s.cardCaption}>{p.caption}</Text> : null}
      </View>
    </View>
  )
}

// One product, full-scale — used for the 'solo' tier AND for any product
// flagged premium/VIP/Signature, which always gets pulled out into its own
// dedicated feature layout regardless of how many other products share its
// section. A high-value piece is never squeezed into a standard grid cell.
// `width` varies by call site: a solo product sharing a page with the
// section heading/briefing gets a smaller square (260) than one on its own
// premium feature page with nothing else on it (340) — see SectionPages.
// Square, not a wide rectangle — owner, 2026-08-24, against the real
// generated PDF: "single item page product image is cropped and should be
// square", same fix as the grid cards (cardImageWrap's own comment).
function FeatureSolo({ p, accent, width = 260 }) {
  return (
    <View style={s.featureRow} wrap={false}>
      <View style={[s.featureImageWrap, s.cardBorder, { width }]}>
        {p.image ? <Image style={s.featureImage} src={p.image} /> : null}
      </View>
      <View style={[s.featureText, { width: 320 }]}>
        {p.tag ? <Tag accent={accent}>{p.tag}</Tag> : null}
        <Text style={s.featureName}>{p.name}</Text>
        {p.caption ? <Text style={s.featureCaption}>{p.caption}</Text> : null}
      </View>
    </View>
  )
}

function FeatureDuo({ products, accent }) {
  return (
    <View style={[s.featureRow, { justifyContent: 'center' }]} wrap={false}>
      {products.map(p => (
        <View key={p.key} style={{ width: 220 }}>
          <View style={[s.featureImageWrap, s.cardBorder]}>
            {p.image ? <Image style={s.featureImage} src={p.image} /> : null}
          </View>
          <View style={{ marginTop: 12 }}>
            {p.tag ? <Tag accent={accent}>{p.tag}</Tag> : null}
            <Text style={s.featureName}>{p.name}</Text>
            {p.caption ? <Text style={s.featureCaption}>{p.caption}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  )
}

// 3 products (also the tail of any paginated group): one centred row,
// square cards — the top tier of the "max 3 per page" cap, so this is as
// dense as any page ever gets. Never a second row: 4+ always paginates
// into more of these instead (see paginate() above).
function Triple({ products, accent }) {
  return (
    <View wrap={false} style={{ flexDirection: 'row', gap: 28, justifyContent: 'center' }}>
      {products.map(p => (
        <View key={p.key} style={{ width: 190 }}>
          <ProductCard p={p} accent={accent} />
        </View>
      ))}
    </View>
  )
}

// No top header any more (see the `footer` style's own comment) — every
// section page starts straight into its title. The logo + page number live
// in the footer instead, bottom-right, per owner's explicit placement ask.
function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footText}>Crystocraft · United Art Metals Factory Ltd</Text>
      <View style={s.footRight}>
        <Image style={s.footLogo} src={logoUrl} />
        <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </View>
  )
}

// One <Page> per chunk of a section's products — a section with more than
// MAX_PER_PAGE products becomes multiple pages automatically via
// paginate() above; every other tier is exactly one page.
function SectionPages({ section, accent }) {
  const featured = section.products.filter(p => p.premium)
  const regular = section.products.filter(p => !p.premium)
  const chunks = paginate(regular)

  const pages = []

  // Featured/premium products each get their own full-feature page,
  // BEFORE the regular grid — a high-value piece leads, never buried
  // mid-grid (brief: "larger, more editorial layouts for VIP/HNW/
  // Signature/premium products... never a tiny standard catalogue card").
  featured.forEach((p, i) => {
    pages.push(
      <Page key={`${section.key}-feature-${i}`} size={PAGE} style={s.page}>
        {/* Heading bound into the SAME wrap={false} block as the feature —
            the exact bug RangeCataloguePDF.jsx's own "bind heading into the
            first row" comment already warns about: if they can split
            independently, the title can strand itself alone on a near-blank
            page while the content overflows to the next. */}
        <View wrap={false}>
          <Text style={s.sectionTitle}>{section.heading}</Text>
          <FeatureSolo p={p} accent={accent} width={340} />
        </View>
        <Footer />
      </Page>,
    )
  })

  const bodyChunks = chunks.length ? chunks : [[]]
  bodyChunks.forEach((chunk, i) => {
    const tier = tierFor(chunk.length)
    pages.push(
      <Page key={`${section.key}-${i}`} size={PAGE} style={s.page}>
        {/* Heading+tagline+briefing bound into the SAME wrap={false} unit
            as the first content block — same reasoning as the premium
            feature page above (and RangeCataloguePDF.jsx's own precedent):
            without this, the heading and the row could split across two
            pages independently, stranding the heading alone. */}
        <View wrap={false}>
          {i === 0 && (
            <>
              <Text style={s.sectionTitle}>{section.heading}</Text>
              {section.tagline ? <Text style={s.sectionTagline}>{section.tagline}</Text> : null}
              {section.briefing ? <Text style={s.sectionBriefing}>{section.briefing}</Text> : null}
            </>
          )}
          {tier === 'solo' && chunk.length === 1 && <FeatureSolo p={chunk[0]} accent={accent} />}
          {tier === 'duo' && <FeatureDuo products={chunk} accent={accent} />}
          {tier === 'triple' && <Triple products={chunk} accent={accent} />}
        </View>
        <Footer />
      </Page>,
    )
  })

  return pages
}

/**
 * @param client       { name, preparedBy, date, reference }
 * @param hero          { image } | null — cover background
 * @param tagline, briefing  cover copy
 * @param sections      [{ key, heading, tagline, briefing, products: [{ key, name, caption, image, tag?, premium? }] }]
 * @param division      'gifts' | 'crystals' | 'bespoke' — picks the accent colour; defaults 'gifts'
 * @param accentColor   explicit hex override (rare — prefer `division`)
 *
 * Images must already be resolved to something react-pdf can embed directly
 * (a data: URI) — this component does no fetching itself, same split
 * RangeCatalogueExport.jsx/QuoteExport.jsx already use (imageToDataURL
 * before calling into the PDF component), because react-pdf can't reliably
 * follow a Firebase Storage URL from a blob-building context.
 */
export default function BrandProposalPDF({ client, hero, tagline, briefing, sections, division, accentColor }) {
  const accent = accentColor || DIVISION_ACCENT[division] || DS_COLORS.bronze
  const clientName = client?.name || ''

  return (
    <Document title={`Crystocraft Brand Proposal${clientName ? ` — ${clientName}` : ''}`} author="Crystocraft">
      {/* Cover — full-bleed hero + structured text block. */}
      <Page size={PAGE} style={s.coverPage}>
        {hero?.image ? <Image style={s.coverImage} src={hero.image} /> : <View style={[s.coverImage, { backgroundColor: DS_COLORS.inkBlack }]} />}
        <Svg style={s.coverScrimSvg} width={PAGE[0]} height={PAGE[1]}>
          <Defs>
            {/* Top: barely darkened, just enough for the logo to read on a
                bright sky. Bottom: dark enough for white text over any photo. */}
            <LinearGradient id="coverScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={DS_COLORS.inkBlack} stopOpacity={0.18} />
              <Stop offset="0.55" stopColor={DS_COLORS.inkBlack} stopOpacity={0.28} />
              <Stop offset="1" stopColor={DS_COLORS.inkBlack} stopOpacity={0.72} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={PAGE[0]} height={PAGE[1]} fill="url(#coverScrim)" />
        </Svg>
        <View style={s.coverContent}>
          <Image style={s.coverLogo} src={logoUrl} />
          <View>
            <Text style={s.coverEyebrow}>Brand Proposal</Text>
            <Text style={s.coverTitle}>{clientName || 'Prepared for you'}</Text>
            {tagline ? <Text style={s.coverTagline}>{tagline}</Text> : null}
          </View>
          <View style={s.coverMetaRow}>
            {client?.preparedBy ? (
              <View><Text style={s.coverMetaLabel}>Prepared By</Text><Text style={s.coverMetaValue}>{client.preparedBy}</Text></View>
            ) : null}
            <View><Text style={s.coverMetaLabel}>Date</Text><Text style={s.coverMetaValue}>{client?.date || ''}</Text></View>
            {client?.reference ? (
              <View><Text style={s.coverMetaLabel}>Reference</Text><Text style={s.coverMetaValue}>{client.reference}</Text></View>
            ) : null}
          </View>
        </View>
      </Page>

      {/* Optional briefing page — only when there's real copy for it, so a
          proposal with just a cover + sections doesn't get a half-empty
          filler page. */}
      {briefing ? (
        <Page size={PAGE} style={s.page}>
          <View style={{ flex: 1, justifyContent: 'center', maxWidth: 620 }}>
            <Text style={s.sectionEyebrow}>The Brief</Text>
            <Text style={{ fontSize: 18, lineHeight: 1.6, color: DS_COLORS.nearBlack }}>{briefing}</Text>
          </View>
          <Footer />
        </Page>
      ) : null}

      {sections.filter(sec => sec.products.length > 0).flatMap(sec => (
        SectionPages({ section: sec, accent })
      ))}
    </Document>
  )
}
