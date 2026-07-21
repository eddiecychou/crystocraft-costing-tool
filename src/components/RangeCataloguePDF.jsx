import { Document, Page, View, Text, Image, Font, StyleSheet } from '@react-pdf/renderer'
import logoUrl from '../assets/logo.png'
import QuestrialRegular from '../assets/fonts/Questrial-Regular.ttf'
import WorkSansRegular  from '../assets/fonts/WorkSans-Regular.ttf'
import WorkSansMedium   from '../assets/fonts/WorkSans-Medium.ttf'
import WorkSansSemiBold from '../assets/fonts/WorkSans-SemiBold.ttf'

// Full-range trade catalogue, priced for one account.
//
// WHY THIS IS NOT THE EXISTING CATALOGUE. Catalogues.jsx builds a curated
// marketing piece — products picked one at a time, printed via window.print().
// That is the right tool for a look-book and the wrong one for a reference
// document a buyer orders from: browser print gives non-deterministic page
// breaks, no page numbers, and no prices. This is generated, paginated and
// priced.
//
// ONE BLOCK PER PRODUCT, AND COLOUR NEVER APPEARS. rangePrice() reads
// variant.ws_price_usd and ignores colour entirely, so enumerating colours
// listed every SKU of a design at an identical price — sixteen rows of
// "USD 3.85" for one butterfly. What actually varies is the variant, which is a
// CRYSTAL BRAND x PLATING pair, so each row reads "Bohemia Crystals, Gold
// Plated". Showing only the plating made those rows look like a meaningless
// repeat of Chrome/Chrome/Gold, because the thing that differed was hidden.

Font.register({ family: 'Questrial', src: QuestrialRegular })
Font.register({ family: 'Work Sans', fonts: [
  { src: WorkSansRegular,  fontWeight: 400 },
  { src: WorkSansMedium,   fontWeight: 500 },
  { src: WorkSansSemiBold, fontWeight: 600 },
] })
Font.registerHyphenationCallback(w => [w])

const C = {
  black: '#1a1a1a', gold: '#c8a951',
  grayDark: '#444444', grayMid: '#888888', grayLabel: '#666666',
  rowAlt: '#fafaf8', border: '#e6e6e6',
}

const fmtDate = d =>
  (d ? new Date(d) : new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 42, paddingHorizontal: 32, fontFamily: 'Questrial', color: C.black, fontSize: 9 },

  // Cover
  cover: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 60 },
  coverLogo: { width: 240, height: Math.round(240 / 5.713), marginBottom: 40 },
  coverTitle: { fontSize: 26, color: C.gold, letterSpacing: 2, marginBottom: 6 },
  coverSub: { fontSize: 11, color: C.grayLabel, letterSpacing: 1, marginBottom: 36 },
  coverFor: { fontSize: 9, color: C.grayMid, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 },
  coverName: { fontSize: 16, marginBottom: 24 },
  coverMeta: { fontSize: 9, color: C.grayLabel, marginTop: 3 },

  // Running header / footer
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
          borderBottomWidth: 0.8, borderBottomColor: C.border, paddingBottom: 5, marginBottom: 10 },
  headLogo: { width: 116, height: Math.round(116 / 5.713) },
  headMeta: { fontSize: 7.5, color: C.grayMid, letterSpacing: 0.6 },
  footer: { position: 'absolute', bottom: 20, left: 32, right: 32,
            flexDirection: 'row', justifyContent: 'space-between',
            borderTopWidth: 0.8, borderTopColor: C.border, paddingTop: 5 },
  footText: { fontSize: 7, color: C.grayMid },

  section: { fontSize: 11, color: C.gold, letterSpacing: 1.2, textTransform: 'uppercase',
             marginTop: 6, marginBottom: 8 },

  // Product block — two per row
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { width: '50%', paddingRight: 10, paddingBottom: 16 },
  cardInner: { flexDirection: 'row' },
  photo: { width: 128, height: 128, objectFit: 'contain', marginRight: 10 },
  photoBlank: { width: 128, height: 128, marginRight: 10, borderWidth: 0.8, borderColor: C.border },
  code: { fontFamily: 'Work Sans', fontWeight: 600, fontSize: 9, letterSpacing: 0.4 },
  name: { fontSize: 8.5, color: C.grayDark, marginTop: 1.5, marginBottom: 4 },
  attr: { fontSize: 7, color: C.grayMid, marginBottom: 3 },

  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  priceRowAlt: { backgroundColor: C.rowAlt },
  plating: { fontSize: 7.5, color: C.grayDark, flex: 1, paddingRight: 6 },
  rowCode: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 6.5, color: C.grayMid, letterSpacing: 0.3 },
  price: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 8.5 },

})

function RunningHead({ account, currency }) {
  return (
    <View style={s.head} fixed>
      <Image style={s.headLogo} src={logoUrl} />
      <Text style={s.headMeta}>
        {account ? `${account} · ` : ''}Prices in {currency}
      </Text>
    </View>
  )
}

function Footer({ validity }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footText}>{validity}</Text>
      {/* react-pdf substitutes these at render, so the count is real. */}
      <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

// One product: hero image, identity, and a brand x plating price table.
function ProductCard({ p }) {
  return (
    <View style={s.card} wrap={false}>
      <View style={s.cardInner}>
        {p.image ? <Image style={s.photo} src={p.image} /> : <View style={s.photoBlank} />}
        <View style={{ flex: 1 }}>
          <Text style={s.code}>{p.code}</Text>
          <Text style={s.name}>{p.name}</Text>
          {p.prices.map((r, i) => (
            <View key={`${r.code}|${r.plating}|${r.price}`} style={[s.priceRow, i % 2 ? s.priceRowAlt : null]}>
              <View style={{ flex: 1, paddingRight: 6 }}>
                {r.code ? <Text style={s.rowCode}>{r.code}</Text> : null}
                <Text style={s.plating}>{r.plating}</Text>
              </View>
              <Text style={s.price}>{r.price}</Text>
            </View>
          ))}
          {p.prices.length === 0 && <Text style={s.attr}>Price on application</Text>}
        </View>
      </View>
    </View>
  )
}

/**
 * @param groups   [{ title, products: [{ code, name, image, prices:[{plating,price}] }] }]
 *
 * No SKU index. It was removed on 2026-07-21: with colour collapsed out, every
 * index row simply repeated a price already printed beside the product it
 * belongs to, and the product blocks are the thing a buyer reads.
 */
export default function RangeCataloguePDF({ account, currency, validity, groups, generatedAt }) {
  return (
    <Document title={`Crystocraft Catalogue${account ? ` — ${account}` : ''}`} author="Crystocraft">
      {/* Cover */}
      <Page size="A4" style={s.page}>
        <View style={s.cover}>
          <Image style={s.coverLogo} src={logoUrl} />
          <Text style={s.coverTitle}>PRODUCT CATALOGUE</Text>
          <Text style={s.coverSub}>Figurine Range</Text>
          {account ? (
            <>
              <Text style={s.coverFor}>Prepared for</Text>
              <Text style={s.coverName}>{account}</Text>
            </>
          ) : null}
          <Text style={s.coverMeta}>All prices in {currency}, ex-works</Text>
          <Text style={s.coverMeta}>{validity}</Text>
          <Text style={s.coverMeta}>Issued {fmtDate(generatedAt)}</Text>
        </View>
      </Page>

      {/* The range */}
      <Page size="A4" style={s.page}>
        <RunningHead account={account} currency={currency} />
        {groups.map(g => (
          <View key={g.title}>
            {/* The heading must not be orphaned at a page foot from its cards. */}
            <Text style={s.section} minPresenceAhead={80}>{g.title}</Text>
            <View style={s.grid}>
              {g.products.map(p => <ProductCard key={p.code} p={p} />)}
            </View>
          </View>
        ))}
        <Footer validity={validity} />
      </Page>

    </Document>
  )
}
