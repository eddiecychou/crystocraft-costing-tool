import { Document, Page, View, Text, Image, Font, StyleSheet } from '@react-pdf/renderer'
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
  // react-pdf has no CSS gradient support, so a dark-toward-the-bottom
  // scrim (for text legibility over a photo) is approximated with several
  // stacked bands of increasing opacity rather than one or two flat
  // layers — two layers left a visible hard seam where they overlapped
  // (caught in the render QA pass), four blends it smoothly enough that
  // no single edge reads as a line.
  coverScrimBase: { position: 'absolute', top: 0, left: 0, width: PAGE[0], height: PAGE[1], backgroundColor: DS_COLORS.inkBlack, opacity: 0.22 },
  coverScrimBand: { position: 'absolute', left: 0, width: PAGE[0], backgroundColor: DS_COLORS.inkBlack },
  coverContent: { position: 'absolute', left: MARGIN, right: MARGIN, bottom: MARGIN, top: MARGIN, justifyContent: 'space-between' },
  coverLogo: { width: 140, height: Math.round(140 / 5.713) },
  coverEyebrow: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: DS_COLORS.champagne, marginBottom: 10 },
  coverTitle: { fontSize: 42, color: DS_COLORS.white, lineHeight: 1.15, maxWidth: 640 },
  coverTagline: { fontSize: 13, color: DS_COLORS.white, opacity: 0.85, marginTop: 14, maxWidth: 520, lineHeight: 1.5 },
  coverMetaRow: { flexDirection: 'row', gap: 40 },
  coverMetaLabel: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 8, letterSpacing: 1.2, textTransform: 'uppercase', color: DS_COLORS.platinum, marginBottom: 3 },
  coverMetaValue: { fontSize: 11, color: DS_COLORS.white },

  // ── Section page chrome ──
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  headLogo: { width: 84, height: Math.round(84 / 5.713) },
  headMeta: { fontFamily: 'Work Sans', fontSize: 7.5, color: DS_COLORS.midGrey, letterSpacing: 0.6 },
  footer: { position: 'absolute', bottom: 20, left: MARGIN, right: MARGIN, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.8, borderTopColor: DS_COLORS.warmGrey, paddingTop: 6 },
  footText: { fontFamily: 'Work Sans', fontSize: 7, color: DS_COLORS.midGrey },

  sectionEyebrow: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 9, letterSpacing: 1.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 4 },
  sectionTitle: { fontSize: 22, color: DS_COLORS.nearBlack, marginBottom: 4 },
  sectionTagline: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 10, color: DS_COLORS.midGrey, marginBottom: 6 },
  sectionBriefing: { fontSize: 9.5, color: DS_COLORS.midGrey, lineHeight: 1.45, maxWidth: 640, marginBottom: 14 },

  // ── Product card — image, name, ONE caption line, optional tag. No specs/
  // MOQ/supplier/lead time anywhere on these pages, per the brief. ──
  cardBorder: { borderWidth: 1, borderColor: DS_COLORS.warmGrey },
  cardImageWrap: { backgroundColor: DS_COLORS.beige, overflow: 'hidden' },
  cardImage: { width: '100%', height: '100%', objectFit: 'cover' },
  cardBody: { paddingTop: 8, paddingHorizontal: 2 },
  cardName: { fontSize: 10.5, color: DS_COLORS.nearBlack, marginBottom: 3 },
  cardCaption: { fontFamily: 'Work Sans', fontSize: 8, color: DS_COLORS.midGrey, lineHeight: 1.35 },
  cardTag: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 6.5, letterSpacing: 0.6, textTransform: 'uppercase', paddingVertical: 3, paddingHorizontal: 7, alignSelf: 'flex-start', marginBottom: 6 },

  // ── Solo / duo feature layouts (1–2 products) ──
  // Deliberately NO flex:1 anywhere in this file for sizing (see
  // ProductCard/FeatureSolo's own comments) — RangeCataloguePDF.jsx already
  // documents why: react-pdf's yoga layout doesn't reliably compute a
  // flex-grown block's height the way CSS flexbox does, and a flex:1 child
  // with no unambiguous available dimension collapses to zero rather than
  // filling space. Every block here gets an EXPLICIT height instead.
  featureRow: { flexDirection: 'row', gap: 28 },
  featureImageWrap: { backgroundColor: DS_COLORS.beige, overflow: 'hidden' },
  featureImage: { width: '100%', height: '100%', objectFit: 'cover' },
  featureText: { justifyContent: 'center' },
  featureName: { fontSize: 22, color: DS_COLORS.nearBlack, marginBottom: 8 },
  featureCaption: { fontFamily: 'Work Sans', fontSize: 10.5, color: DS_COLORS.midGrey, lineHeight: 1.5, maxWidth: 300 },
})

// ── Adaptive tiering — the whole point of this file. Never one fixed grid. ──
function tierFor(count) {
  if (count <= 1) return 'solo'
  if (count === 2) return 'duo'
  if (count <= 4) return 'quad'
  return 'grid8' // 5–8 handled directly; 9+ is chunked into grid8 pages by paginate() below
}

// 9–12 (and beyond) split across pages rather than shrinking cards — chunk
// into groups of up to 8, each rendered as its own grid8 page. A 9-item
// section becomes two pages (8 + 1, the trailing single centred rather than
// stretched — see Grid8's own handling of a short final row).
function paginate(products) {
  if (products.length <= 8) return [products]
  const pages = []
  for (let i = 0; i < products.length; i += 8) pages.push(products.slice(i, i + 8))
  return pages
}

function Tag({ children, accent }) {
  if (!children) return null
  return <Text style={[s.cardTag, { color: accent, backgroundColor: accent + '14', borderWidth: 1, borderColor: accent + '33' }]}>{children}</Text>
}

function ProductCard({ p, accent, imgH = 150 }) {
  // No flex:1 wrapper — see the style block's own comment above. This is
  // the exact bug RangeCataloguePDF.jsx's ProductCard comment already
  // warns about, reintroduced and caught live by rendering every tier
  // before shipping (owner's own QA requirement): a flex:1 root here, nested
  // inside a plain-width column, collapsed every grid card's image to
  // nothing and overlapped every row of text.
  return (
    <View>
      <View style={[s.cardImageWrap, s.cardBorder, { height: imgH }]}>
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
// flagged premium/VIP/Signature (see isPremium below), which always gets
// pulled out into its own dedicated feature layout regardless of how many
// other products share its section. A high-value piece is never squeezed
// into a standard grid cell.
// `height` varies by call site: a solo product sharing a page with the
// section heading/briefing gets less room (300) than one on its own
// premium feature page with nothing else on it (420) — see SectionPages.
function FeatureSolo({ p, accent, height = 300 }) {
  return (
    <View style={s.featureRow} wrap={false}>
      <View style={[s.featureImageWrap, s.cardBorder, { width: '54%', height }]}>
        {p.image ? <Image style={s.featureImage} src={p.image} /> : null}
      </View>
      <View style={[s.featureText, { width: '38%', height, justifyContent: 'center' }]}>
        {p.tag ? <Tag accent={accent}>{p.tag}</Tag> : null}
        <Text style={s.featureName}>{p.name}</Text>
        {p.caption ? <Text style={s.featureCaption}>{p.caption}</Text> : null}
      </View>
    </View>
  )
}

function FeatureDuo({ products, accent }) {
  return (
    <View style={s.featureRow} wrap={false}>
      {products.map(p => (
        <View key={p.key} style={{ width: '46%' }}>
          <View style={[s.featureImageWrap, s.cardBorder, { height: 260 }]}>
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

// 3–4 products: a balanced 2x2. A 3-item section centres its short final
// row instead of stretching the third card wide or leaving a bare gap —
// explicit brief requirement ("intentional editorial arrangement... rather
// than a large accidental-looking gap").
function GridQuad({ products, accent }) {
  const rows = [products.slice(0, 2), products.slice(2, 4)]
  return (
    <View wrap={false}>
      {rows.map((row, i) => row.length > 0 && (
        <View key={i} style={{ flexDirection: 'row', gap: 24, marginBottom: 20, justifyContent: row.length === 1 ? 'center' : 'flex-start' }}>
          {row.map(p => (
            <View key={p.key} style={{ width: row.length === 1 ? '46%' : '48%' }}>
              <ProductCard p={p} accent={accent} imgH={190} />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

// 5–8 products: landscape 4-across x up-to-2-deep grid. Same "no flexWrap"
// reasoning RangeCataloguePDF.jsx already documents — react-pdf doesn't
// size a wrapped flex line by its tallest child, so rows are explicit and
// each row is its own wrap={false} block.
const PER_ROW = 4
function chunkRows(list) {
  const out = []
  for (let i = 0; i < list.length; i += PER_ROW) out.push(list.slice(i, i + PER_ROW))
  return out
}
function Grid8({ products, accent }) {
  return (
    <View wrap={false}>
      {chunkRows(products).map((row, i) => (
        <View key={i} wrap={false} style={{ flexDirection: 'row', gap: 18, marginBottom: 16, justifyContent: row.length < PER_ROW ? 'center' : 'flex-start' }}>
          {row.map(p => (
            <View key={p.key} style={{ width: row.length < PER_ROW ? `${100 / Math.max(row.length, 1) - 4}%` : '22.5%' }}>
              {/* 100, not 130 — measured live: two rows at 130 (plus card
                  body text) genuinely don't fit under the heading/briefing
                  block within one page's safe area, which pushed the whole
                  grid onto its own page and left the heading alone on a
                  near-blank one (caught in the render QA pass). 100 keeps
                  both rows comfortably inside the remaining height. */}
              <ProductCard p={p} accent={accent} imgH={100} />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

function RunningHead({ clientName }) {
  return (
    <View style={s.head} fixed>
      <Image style={s.headLogo} src={logoUrl} />
      <Text style={s.headMeta}>{clientName ? `Prepared for ${clientName}` : ''}</Text>
    </View>
  )
}
function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footText}>Crystocraft · United Art Metals Factory Ltd</Text>
      <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

// One <Page> per chunk of a section's products — a section with 9–12+
// products becomes multiple pages automatically via paginate() above; every
// OTHER tier is exactly one page.
function SectionPages({ section, accent, clientName, isFirstOfDocument }) {
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
        <RunningHead clientName={clientName} />
        {/* Heading bound into the SAME wrap={false} block as the feature —
            the exact bug RangeCataloguePDF.jsx's own "bind heading into the
            first row" comment already warns about, reproduced here: at
            height 420 the block didn't fit under the title, so it overflowed
            to its own page and stranded the title alone on a near-blank one
            (caught in the render QA pass). Wrapping them together plus a
            height that actually fits (360, not 420) fixes both the orphan
            and the overflow. */}
        <View wrap={false}>
          <Text style={s.sectionTitle}>{section.heading}</Text>
          <FeatureSolo p={p} accent={accent} height={360} />
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
        <RunningHead clientName={clientName} />
        {/* Heading+tagline+briefing bound into the SAME wrap={false} unit
            as the first content block — same reasoning as the premium
            feature page above (and RangeCataloguePDF.jsx's own precedent):
            without this, the heading and the grid could split across two
            pages independently, stranding the heading alone. */}
        <View wrap={false}>
          {i === 0 && (
            <>
              <Text style={s.sectionTitle}>{section.heading}</Text>
              {section.tagline ? <Text style={s.sectionTagline}>{section.tagline}</Text> : null}
              {section.briefing ? <Text style={s.sectionBriefing}>{section.briefing}</Text> : null}
            </>
          )}
          {chunk.length === 1 && <FeatureSolo p={chunk[0]} accent={accent} />}
          {chunk.length === 2 && <FeatureDuo products={chunk} accent={accent} />}
          {(tier === 'quad') && <GridQuad products={chunk} accent={accent} />}
          {tier === 'grid8' && <Grid8 products={chunk} accent={accent} />}
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
        <View style={s.coverScrimBase} />
        <View style={[s.coverScrimBand, { bottom: 0, height: 340, opacity: 0.14 }]} />
        <View style={[s.coverScrimBand, { bottom: 0, height: 220, opacity: 0.16 }]} />
        <View style={[s.coverScrimBand, { bottom: 0, height: 120, opacity: 0.18 }]} />
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
          <RunningHead clientName={clientName} />
          <View style={{ flex: 1, justifyContent: 'center', maxWidth: 620 }}>
            <Text style={s.sectionEyebrow}>The Brief</Text>
            <Text style={{ fontSize: 18, lineHeight: 1.6, color: DS_COLORS.nearBlack }}>{briefing}</Text>
          </View>
          <Footer />
        </Page>
      ) : null}

      {sections.filter(sec => sec.products.length > 0).flatMap(sec => (
        SectionPages({ section: sec, accent, clientName })
      ))}
    </Document>
  )
}
