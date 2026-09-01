// Headless render of the real BrandProposalPDF, data shaped like
// brandProposalExport.jsx builds it. Lets the layout be inspected without a
// browser or a deploy. See qa/README.md.
//   node <bundle> /tmp/proposal.pdf
//   pdftoppm -png -r 90 /tmp/proposal.pdf /tmp/proposal   ->  /tmp/proposal-1.png …
import { deflateSync } from 'zlib'
import ReactPDF from '@react-pdf/renderer'
import BrandProposalPDF from '../src/components/BrandProposalPDF.jsx'

// Minimal solid-colour PNG (real PNG bytes, so react-pdf embeds it like a
// photo) — stands in for product/hero imagery for layout inspection only.
function solidPng(hex, w = 320, h = 320) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b
    }
  }
  const crc = (buf) => {
    let c = ~0
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit, truecolor
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

const HERO = solidPng('#3a2b30', 960, 540)
const P = (key, name, caption, hex, extra = {}) => ({ key, name, caption, image: solidPng(hex), ...extra })

const sections = [
  {
    key: 'recognition',
    heading: 'The recognition story',
    tagline: 'Milestones, made tangible',
    briefing: 'Optical-crystal awards and desk pieces chosen for annual recognition, partner appreciation and long-service milestones — each ready to carry the Sun Life mark.',
    products: [
      P('a', 'Etched Crystal Recognition Award', 'Bevelled optical crystal, deep-etched 3D logo, satin-lined gift box.', '#6e2433', { premium: true, tag: 'Signature' }),
      P('b', 'Facet Tower', 'A slender faceted column that throws light across a desk.', '#7a4f26'),
      P('c', 'Crystal Disc on Base', 'Free-standing disc, sub-surface engraving.', '#1c4f64'),
      P('d', 'Cube Paperweight', 'Solid crystal cube, felt-based non-slip pad.', '#996632'),
    ],
  },
  {
    // Premium-only section — no regular products. Used to leave a blank
    // page behind the feature (owner report, p.20).
    key: 'connected',
    heading: 'Connected everyday',
    tagline: 'Smart, sleek, always in reach',
    briefing: 'A single hero piece for the modern desk.',
    products: [
      P('h', 'Charging Cable with Adaptor & Phone Stand', 'A premium charging cable with adaptor & phone stand that blends smart functionality with sleek design for modern productivity.', '#5b1c29', { premium: true, tag: 'Signature' }),
    ],
  },
  {
    // Full heading + a duo with long, 3-line captions — the case that
    // stranded the heading on its own page (owner report, pp.21–22).
    key: 'moments',
    heading: 'Sunlit moments',
    tagline: 'Gifts for shared time and relaxed connection',
    briefing: 'Social and leisure gifts built around gathering, conversation and shared moments of joy.',
    products: [
      P('e', '10L Insulated Camping Cooler', 'Create memorable shared experiences with this 10l insulated camping cooler, perfect for social connection.', '#1c4f64'),
      P('f', 'Mahjong Gift Set', 'Create memorable shared experiences with this mahjong gift set, perfect for social connection.', '#996632'),
    ],
  },
  {
    key: 'seasonal',
    heading: 'Seasonal & gifting',
    tagline: '',
    briefing: 'A single hero piece for year-end client gifting.',
    products: [
      P('g', 'Snow Star Ornament', 'Faceted six-point star, ribbon loop, presentation pouch.', '#8b3347'),
    ],
  },
]

ReactPDF.render(
  <BrandProposalPDF
    client={{ name: 'Sun Life', preparedBy: 'Eddie Chou', date: '2 September 2026', reference: 'CG-2026-0912' }}
    hero={{ image: HERO }}
    tagline="Crystal that carries your brand — a curated set for 2026 recognition and gifting."
    briefing="Sun Life asked for a recognition-and-gifting range that feels considered rather than promotional: optical crystal and metal only, restrained branding, and a clear split between milestone awards and everyday desk pieces. This proposal groups the selection that way, leads with the Signature award, and keeps every page to at most three pieces so nothing is squeezed."
    sections={sections}
    division="gifts"
  />,
  process.argv[2],
).then(() => console.log('rendered ->', process.argv[2]))
  .catch(e => { console.error('RENDER FAILED:', e.message); process.exit(1) })
