// On-brand quotation PDF (react-pdf). Embeds the real brand fonts (Questrial +
// Work Sans) and a Traditional-Chinese fallback (Noto Sans TC) so Chinese client
// names render. Layout is flexbox so images sit vertically centred with no empty
// space — fixing the alignment/whitespace issues of the old Excel export.
import {
  Document, Page, View, Text, Image, Font, StyleSheet,
} from '@react-pdf/renderer'
import logoUrl from '../assets/logo.png'
import QuestrialRegular from '../assets/fonts/Questrial-Regular.ttf'
import WorkSansRegular  from '../assets/fonts/WorkSans-Regular.ttf'
import WorkSansMedium   from '../assets/fonts/WorkSans-Medium.ttf'
import WorkSansSemiBold from '../assets/fonts/WorkSans-SemiBold.ttf'

// Full Traditional-Chinese face (~5.7MB) is loaded from a pinned CDN at render
// time rather than bundled in git. react-pdf only fetches it when a Text actually
// uses the family — i.e. only for quotes that contain Chinese characters.
const NOTO_TC_URL = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-tc@0.2.3/NotoSansTC_400Regular.ttf'

// ── Fonts ──────────────────────────────────────────────────────────────────
Font.register({ family: 'Questrial', src: QuestrialRegular })
Font.register({ family: 'Work Sans', fonts: [
  { src: WorkSansRegular,  fontWeight: 400 },
  { src: WorkSansMedium,   fontWeight: 500 },
  { src: WorkSansSemiBold, fontWeight: 600 },
] })
Font.register({ family: 'Noto Sans TC', src: NOTO_TC_URL })
// Keep words intact — never hyphenate-split product names or codes.
Font.registerHyphenationCallback(w => [w])

// ── Brand palette ──────────────────────────────────────────────────────────
const C = {
  black: '#1a1a1a', gold: '#c8a951',
  grayDark: '#444444', grayMid: '#888888', grayLabel: '#666666',
  rowAlt: '#fafaf8', headerBg: '#ededed', border: '#e6e6e6',
}

// CJK detection → swap content fields to the Traditional-Chinese face.
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/
const contentFont = s => (CJK.test(String(s ?? '')) ? 'Noto Sans TC' : 'Questrial')

const fmtMoney = v =>
  (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = d =>
  (d ? new Date(d) : new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

// Column widths (content area ≈ 531pt on A4 with 32pt side padding)
const W = { num: 16, photo: 72, product: 104, desc: 155, qty: 38, price: 68, amount: 78 }

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 44, paddingHorizontal: 32, fontFamily: 'Questrial', color: C.black, fontSize: 9 },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 },
  logo: { width: 188, height: Math.round(188 / 5.713) },
  title: { fontFamily: 'Questrial', fontSize: 22, color: C.gold, letterSpacing: 1 },
  goldRule: { borderBottomWidth: 1.4, borderBottomColor: C.gold, marginBottom: 12 },

  // Client info
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  infoCol: { flexDirection: 'column', width: 330 },
  infoLine: { flexDirection: 'row', marginBottom: 3, alignItems: 'flex-start' },
  label: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 7, color: C.grayLabel, letterSpacing: 1.3, width: 62, paddingTop: 1 },
  labelRight: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 7, color: C.grayLabel, letterSpacing: 1.3, marginRight: 8, textAlign: 'right' },
  value: { fontSize: 9, color: C.black, flex: 1 },
  valueStrong: { fontSize: 10.5, color: C.black },
  infoRightLine: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 3 },

  // Table header band
  thead: { flexDirection: 'row', backgroundColor: C.headerBg, paddingVertical: 6, paddingHorizontal: 2, alignItems: 'center' },
  th: { fontFamily: 'Work Sans', fontWeight: 600, fontSize: 7.5, color: C.grayDark, letterSpacing: 0.8 },

  // Item rows
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: 0.6, borderBottomColor: C.border },
  num: { width: W.num, fontSize: 8, color: C.grayMid, textAlign: 'center' },
  photoCell: { width: W.photo, alignItems: 'center', justifyContent: 'center' },
  img: { width: 70, height: 70, objectFit: 'contain' },
  productCell: { width: W.product, paddingRight: 8 },
  productName: { fontSize: 9.5, color: C.black },
  descCell: { width: W.desc, paddingRight: 8 },
  descText: { fontSize: 8, color: C.grayDark, lineHeight: 1.45 },
  qtyCell: { width: W.qty, alignItems: 'center' },
  priceCell: { width: W.price, alignItems: 'flex-end' },
  amountCell: { width: W.amount, alignItems: 'flex-end' },
  tierLine: { marginVertical: 1 },
  qtyText: { fontSize: 9, color: C.black, textAlign: 'center' },
  priceText: { fontSize: 9, color: C.black },
  amountText: { fontSize: 9, color: C.black },
  itemRemark: { fontSize: 7.5, color: C.grayMid, marginTop: 3, lineHeight: 1.4 },

  // Total
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8 },
  totalLabel: { fontFamily: 'Work Sans', fontWeight: 600, fontSize: 8.5, color: C.grayDark, letterSpacing: 0.8, marginRight: 12 },
  totalValue: { fontFamily: 'Work Sans', fontWeight: 600, fontSize: 12, color: C.black, width: W.amount, textAlign: 'right' },

  // Footer area
  goldClose: { borderTopWidth: 1.4, borderTopColor: C.gold, marginTop: 4, marginBottom: 12 },
  notes: { fontSize: 8, color: C.grayDark, marginBottom: 10 },
  notesLabel: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 7, color: C.grayMid, letterSpacing: 1.2 },
  terms: { fontSize: 7.5, color: C.grayMid, textAlign: 'center', marginBottom: 14 },

  // Signatures
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26, marginBottom: 16 },
  signBox: { width: 220, position: 'relative' },
  signSpace: { height: 46 },
  stampImg: { position: 'absolute', bottom: 0, left: 4, width: 130, height: 48, objectFit: 'contain' },
  signLine: { borderTopWidth: 0.8, borderTopColor: C.grayMid, paddingTop: 4 },
  signRole: { fontFamily: 'Work Sans', fontWeight: 500, fontSize: 7, color: C.grayMid, letterSpacing: 1, marginBottom: 2 },
  signName: { fontSize: 8.5, color: C.grayDark },

  footLine: { fontSize: 7.5, color: C.grayDark, textAlign: 'center', marginBottom: 2 },
  footStrong: { fontFamily: 'Work Sans', fontWeight: 600 },
})

function InfoLine({ label, children, strong }) {
  return (
    <View style={s.infoLine}>
      <Text style={s.label}>{label}</Text>
      <Text style={strong ? s.valueStrong : s.value}>{children}</Text>
    </View>
  )
}

// First (primary) tier of an item + its line amount.
const firstTier = item => (item.tiers?.length ? item.tiers : [{ quantity: item.quantity ?? '', price: item.price ?? item.price_hkd ?? '' }])[0]
const tierAmount = t => (Number(t?.quantity) || 0) * (Number(t?.price ?? t?.price_hkd) || 0)

export default function QuotePDF({ quote, items }) {
  const cur = quote.quote_currency || 'HKD'
  const clientName  = quote.client_name || '—'
  const contactLine = [quote.contact_name, quote.contact_email].filter(Boolean).join('   ·   ') || '—'
  // Grand total from each item's primary (first) tier.
  const grandTotal = items.reduce((sum, item) => sum + tierAmount(firstTier(item)), 0)

  return (
    <Document title={`Quotation ${clientName}`} author="Crystocraft">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.headerRow}>
          <Image src={logoUrl} style={s.logo} />
          <Text style={s.title}>QUOTATION</Text>
        </View>
        <View style={s.goldRule} />

        {/* Client info */}
        <View style={s.infoRow}>
          <View style={s.infoCol}>
            <View style={s.infoLine}>
              <Text style={s.label}>TO</Text>
              <Text style={[s.valueStrong, { fontFamily: contentFont(clientName) }]}>{clientName}</Text>
            </View>
            <View style={s.infoLine}>
              <Text style={s.label}>CONTACT</Text>
              <Text style={[s.value, { fontFamily: contentFont(contactLine) }]}>{contactLine}</Text>
            </View>
            <InfoLine label="PHONE">{quote.contact_phone || '—'}</InfoLine>
            <View style={s.infoLine}>
              <Text style={s.label}>ADDRESS</Text>
              <Text style={[s.value, { fontFamily: contentFont(quote.contact_address) }]}>{quote.contact_address || '—'}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'column', width: 170 }}>
            {quote.quote_no ? (
              <View style={s.infoRightLine}>
                <Text style={s.labelRight}>QU P/O NO</Text>
                <Text style={s.valueStrong}>{quote.quote_no}</Text>
              </View>
            ) : null}
            {quote.ref_no ? (
              <View style={s.infoRightLine}>
                <Text style={s.labelRight}>REF NO</Text>
                <Text style={s.value}>{quote.ref_no}</Text>
              </View>
            ) : null}
            <View style={s.infoRightLine}>
              <Text style={s.labelRight}>DATE</Text>
              <Text style={s.value}>{fmtDate(quote.quote_date)}</Text>
            </View>
            <View style={s.infoRightLine}>
              <Text style={s.labelRight}>CURRENCY</Text>
              <Text style={s.value}>{cur}</Text>
            </View>
          </View>
        </View>

        {/* Table header */}
        <View style={s.thead}>
          <Text style={[s.th, { width: W.num }]}> </Text>
          <Text style={[s.th, { width: W.photo }]}> </Text>
          <Text style={[s.th, { width: W.product }]}>PRODUCT</Text>
          <Text style={[s.th, { width: W.desc }]}>DESCRIPTION</Text>
          <Text style={[s.th, { width: W.qty, textAlign: 'center' }]}>QTY</Text>
          <Text style={[s.th, { width: W.price, textAlign: 'right' }]}>{`UNIT PRICE (${cur})`}</Text>
          <Text style={[s.th, { width: W.amount, textAlign: 'right' }]}>{`AMOUNT (${cur})`}</Text>
        </View>

        {/* Item rows */}
        {items.map((item, i) => {
          const tiers = item.tiers?.length ? item.tiers : [{ quantity: item.quantity ?? '', price: item.price ?? item.price_hkd ?? '' }]
          const img   = item._imageData || null
          return (
            <View key={i} style={[s.row, i % 2 === 1 ? { backgroundColor: C.rowAlt } : null]} wrap={false}>
              <Text style={s.num}>{i + 1}</Text>
              <View style={s.photoCell}>{img ? <Image src={img} style={s.img} /> : null}</View>
              <View style={s.productCell}>
                <Text style={[s.productName, { fontFamily: contentFont(item.product_name) }]}>{item.product_name || ''}</Text>
              </View>
              <View style={s.descCell}>
                <Text style={[s.descText, { fontFamily: contentFont(item.product_description) }]}>{item.product_description || ''}</Text>
                {item.item_remarks ? (
                  <Text style={[s.itemRemark, { fontFamily: contentFont(item.item_remarks) }]}>{item.item_remarks}</Text>
                ) : null}
              </View>
              <View style={s.qtyCell}>
                {tiers.map((t, k) => <Text key={k} style={[s.qtyText, s.tierLine]}>{t.quantity ?? ''}</Text>)}
              </View>
              <View style={s.priceCell}>
                {tiers.map((t, k) => (
                  <Text key={k} style={[s.priceText, s.tierLine]}>{fmtMoney(t.price ?? t.price_hkd)}</Text>
                ))}
              </View>
              <View style={s.amountCell}>
                {tiers.map((t, k) => (
                  <Text key={k} style={[s.amountText, s.tierLine]}>{fmtMoney(tierAmount(t))}</Text>
                ))}
              </View>
            </View>
          )
        })}

        {/* Grand total */}
        {grandTotal > 0 ? (
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>{`TOTAL (${cur})`}</Text>
            <Text style={s.totalValue}>{fmtMoney(grandTotal)}</Text>
          </View>
        ) : null}

        {/* Closing */}
        <View style={s.goldClose} />

        {quote.notes ? (
          <Text style={s.notes}>
            <Text style={s.notesLabel}>REMARKS  </Text>
            <Text style={{ fontFamily: contentFont(quote.notes) }}>{quote.notes}</Text>
          </Text>
        ) : null}

        <Text style={s.terms}>
          {`All prices in ${cur}. For reference only — subject to final confirmation. MOQ and lead times may vary.`}
        </Text>

        {/* Signatures */}
        <View style={s.signRow} wrap={false}>
          <View style={s.signBox}>
            <View style={s.signSpace}>
              {quote._stampData ? <Image src={quote._stampData} style={s.stampImg} /> : null}
            </View>
            <View style={s.signLine}>
              <Text style={s.signRole}>ISSUED BY</Text>
              <Text style={s.signName}>United Art Metals Factory Limited</Text>
            </View>
          </View>
          <View style={s.signBox}>
            <View style={s.signSpace} />
            <View style={s.signLine}>
              <Text style={s.signRole}>CONFIRMED BY</Text>
              <Text style={[s.signName, { fontFamily: contentFont(clientName) }]}>{clientName}</Text>
            </View>
          </View>
        </View>

        <Text style={[s.footLine, s.footStrong]}>United Art Metals Factory Limited</Text>
        <Text style={s.footLine}>11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong</Text>
        <Text style={s.footLine}>WhatsApp: +852 4608 3219   |   Email: sales@uart.com.hk</Text>
      </Page>
    </Document>
  )
}
