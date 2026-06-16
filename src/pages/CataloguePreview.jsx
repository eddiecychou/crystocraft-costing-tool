import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import logo from '../assets/logo.png'

// ── Auto layout ───────────────────────────────────────────────────────────────
// 1–2 images → quarter page (4 per A4)
// 3–4 images → half page   (2 per A4)
// 5+  images → full page   (1 per A4)
function getLayout(item) {
  const count = item.selected_images?.length || (item.hero_image ? 1 : 0)
  if (count >= 5) return 'full'
  if (count <= 3) return 'quarter'
  return 'half'
}

// ── Cover page ────────────────────────────────────────────────────────────────
function CoverPage({ catalogue }) {
  const hasBg = Boolean(catalogue.cover_image)
  const overlayColor   = catalogue.overlay_color   || 'black'
  const overlayOpacity = catalogue.overlay_opacity ?? 0.45

  return (
    <div className="catalogue-page cover-page" style={{ background: hasBg ? 'none' : '#1a1a1a' }}>
      {/* Background image */}
      {hasBg && (
        <img
          src={catalogue.cover_image}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      {/* Colour overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: overlayColor === 'white' ? 'white' : 'black',
        opacity: overlayOpacity,
      }} />
      {/* Content — bottom right */}
      <div className="cover-inner">
        <img src={logo} alt="Crystocraft" className="cover-logo" />
        <div className="cover-divider" />
        <h1 className="cover-title">{catalogue.name}</h1>
        {catalogue.season && <p className="cover-season">{catalogue.season}</p>}
        {catalogue.tagline && <p className="cover-tagline">{catalogue.tagline}</p>}
      </div>
    </div>
  )
}

// ── Quarter-page layout (up to 4 products in a 2×2 grid) ─────────────────────
function QuarterPage({ slots, nums }) {
  // Pad to exactly 4 slots
  const padded = [...slots]
  while (padded.length < 4) padded.push(null)

  return (
    <div className="catalogue-page quarter-page">
      {padded.map((item, idx) => {
        if (!item) return <div key={idx} className="quarter-item quarter-empty" />
        const images = item.selected_images?.length ? item.selected_images : [item.hero_image].filter(Boolean)
        const isSingle = images.length === 1
        const isTriple = images.length === 3

        return isSingle ? (
          // Single image: image left, text right
          <div key={idx} className="quarter-item quarter-item-row">
            <div className="quarter-img-side">
              <ImageGrid images={images} />
            </div>
            <div className="quarter-text-side">
              <div className="product-num xsmall">{String(nums[idx]).padStart(2, '0')}</div>
              <h2 className="product-name xsmall">{item.product_name}</h2>
              {item.product_category && <p className="product-category">{item.product_category}</p>}
              <div className="product-divider" />
              {item.marketing_description && (
                <p className="product-marketing xsmall">{item.marketing_description}</p>
              )}
              {item.product_description && (
                <p className="product-spec-text xsmall">{item.product_description}</p>
              )}
            </div>
          </div>
        ) : isTriple ? (
          // 3 images: horizontal row on top (50%), text below (50%)
          <div key={idx} className="quarter-item quarter-3">
            <div className="quarter-img-area">
              <div className="ig ig-2">
                {images.map((url, i) => <div key={i} className="ig-cell"><img src={url} alt="" /></div>)}
              </div>
            </div>
            <div className="quarter-content">
              <div className="product-num xsmall">{String(nums[idx]).padStart(2, '0')}</div>
              <h2 className="product-name xsmall">{item.product_name}</h2>
              {item.product_category && <p className="product-category">{item.product_category}</p>}
              <div className="product-divider" />
              {item.marketing_description && (
                <p className="product-marketing xsmall">{item.marketing_description}</p>
              )}
              {item.product_description && (
                <p className="product-spec-text xsmall">{item.product_description}</p>
              )}
            </div>
          </div>
        ) : (
          // 2 images: text left, 2 images stacked vertically on right
          <div key={idx} className="quarter-item quarter-2col">
            <div className="quarter-2-text">
              <div className="product-num xsmall">{String(nums[idx]).padStart(2, '0')}</div>
              <h2 className="product-name xsmall">{item.product_name}</h2>
              {item.product_category && <p className="product-category">{item.product_category}</p>}
              <div className="product-divider" />
              {item.marketing_description && (
                <p className="product-marketing xsmall">{item.marketing_description}</p>
              )}
              {item.product_description && (
                <p className="product-spec-text xsmall">{item.product_description}</p>
              )}
            </div>
            <div className="quarter-2-imgs">
              {images.map((url, i) => (
                <div key={i} className="ig-cell"><img src={url} alt="" /></div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Dynamic image grid ────────────────────────────────────────────────────────
// Renders images differently depending on count.
// isHalf: true when inside a half-page panel (less horizontal space).
function ImageGrid({ images }) {
  const count = images.length
  if (!count) return null

  // 1 image — full fill
  if (count === 1) {
    return (
      <div className="ig ig-1">
        <div className="ig-cell"><img src={images[0]} alt="" /></div>
      </div>
    )
  }

  // 2 images — side by side
  if (count === 2) {
    return (
      <div className="ig ig-2">
        <div className="ig-cell"><img src={images[0]} alt="" /></div>
        <div className="ig-cell"><img src={images[1]} alt="" /></div>
      </div>
    )
  }

  // 3 images — hero top full-width, two below side by side
  if (count === 3) {
    return (
      <div className="ig ig-col">
        <div className="ig-cell ig-hero"><img src={images[0]} alt="" /></div>
        <div className="ig ig-sub">
          <div className="ig-cell"><img src={images[1]} alt="" /></div>
          <div className="ig-cell"><img src={images[2]} alt="" /></div>
        </div>
      </div>
    )
  }

  // 4 images — 2×2 grid
  if (count === 4) {
    return (
      <div className="ig ig-grid2">
        {images.map((url, i) => <div key={i} className="ig-cell"><img src={url} alt="" /></div>)}
      </div>
    )
  }

  // 5+ — shouldn't appear in half-page context (those go to FullPage),
  // but as a safe fallback show hero + sub-row
  const subs = images.slice(1, 3)
  return (
    <div className="ig ig-col">
      <div className="ig-cell" style={{ flex: 1 }}><img src={images[0]} alt="" /></div>
      <div className="ig ig-sub">
        {subs.map((url, i) => <div key={i} className="ig-cell"><img src={url} alt="" /></div>)}
      </div>
    </div>
  )
}

// ── Full-page layout (1 product, 5+ images) ──────────────────────────────────
// Left pane:  hero image (top, ~62%) + 2 supporting images (bottom row, ~38%)
// Right pane: product text (top) + remaining images in a horizontal row (bottom ~40%)
function FullPage({ item, num }) {
  const images = item.selected_images?.length ? item.selected_images : [item.hero_image].filter(Boolean)

  // Left: hero + up to 3 below. Right: up to 2 images at bottom.
  const leftHero   = images[0]
  const leftSubs   = images.slice(1, 4)          // up to 3 images in the left sub-row
  const rightImgs  = images.slice(4, 6)          // up to 2 images in right pane

  return (
    <div className="catalogue-page product-page">
      {/* Left pane */}
      <div className="full-left">
        {/* Hero */}
        <div className="fl-hero">
          {leftHero && <img src={leftHero} alt="" />}
        </div>
        {/* Sub-row: up to 2 images */}
        {leftSubs.length > 0 && (
          <div className="fl-sub-row">
            {leftSubs.map((url, i) => (
              <div key={i} className="ig-cell"><img src={url} alt="" /></div>
            ))}
          </div>
        )}
      </div>

      {/* Right pane */}
      <div className="full-right">
        {/* Text block */}
        <div className="full-text-block">
          <div className="product-num">{String(num).padStart(2, '0')}</div>
          <h2 className="product-name">{item.product_name}</h2>
          {item.product_category && <p className="product-category">{item.product_category}</p>}
          <div className="product-divider" />
          {item.marketing_description && (
            <p className="product-marketing">{item.marketing_description}</p>
          )}
          {item.product_description && (
            <div className="product-spec">
              <p className="product-spec-label">Specifications</p>
              <p className="product-spec-text">{item.product_description}</p>
            </div>
          )}
          <div className="product-contact">
            <p>Contact us for pricing &amp; availability</p>
          </div>
        </div>

        {/* Right-pane image row — shown only when there are images here */}
        {rightImgs.length > 0 && (
          <div className="full-right-imgs">
            {rightImgs.map((url, i) => (
              <div key={i} className="ig-cell"><img src={url} alt="" /></div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Half-page layout (1–2 products side by side) ──────────────────────────────
function HalfPage({ left, right, numLeft, numRight }) {
  function HalfItem({ item, num }) {
    const images = item.selected_images?.length ? item.selected_images : [item.hero_image].filter(Boolean)

    // 3-image layout: vertical image column on left, text on right
    if (images.length === 3) {
      return (
        <div className="half-item half-3col">
          <div className="half-3-imgs">
            {images.map((url, i) => (
              <div key={i} className="ig-cell"><img src={url} alt="" /></div>
            ))}
          </div>
          <div className="half-3-text">
            <div className="product-num small">{String(num).padStart(2, '0')}</div>
            <h2 className="product-name small">{item.product_name}</h2>
            {item.product_category && <p className="product-category">{item.product_category}</p>}
            <div className="product-divider" />
            {item.marketing_description && (
              <p className="product-marketing small">{item.marketing_description}</p>
            )}
            {item.product_description && (
              <p className="product-spec-text small">{item.product_description}</p>
            )}
          </div>
        </div>
      )
    }

    // 4-image layout: fully inline-styled to avoid any CSS class interference
    if (images.length === 4) {
      return (
        <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: '0 0 65%', display: 'flex', padding: '14px 14px 8px', boxSizing: 'border-box', overflow: 'hidden' }}>
            <ImageGrid images={images} />
          </div>
          <div style={{ flex: '0 0 35%', padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
            <div className="product-num small">{String(num).padStart(2, '0')}</div>
            <h2 className="product-name small">{item.product_name}</h2>
            {item.product_category && <p className="product-category">{item.product_category}</p>}
            <div className="product-divider" />
            {item.marketing_description && (
              <p className="product-marketing small">{item.marketing_description}</p>
            )}
            {item.product_description && (
              <p className="product-spec-text small">{item.product_description}</p>
            )}
          </div>
        </div>
      )
    }

    // Default layout: images on top, text below
    return (
      <div className="half-item">
        {images.length > 0 && (
          <div className="half-img-area">
            <ImageGrid images={images} />
          </div>
        )}
        <div className="half-content">
          <div className="product-num small">{String(num).padStart(2, '0')}</div>
          <h2 className="product-name small">{item.product_name}</h2>
          {item.product_category && <p className="product-category">{item.product_category}</p>}
          <div className="product-divider" />
          {item.marketing_description && (
            <p className="product-marketing small">{item.marketing_description}</p>
          )}
          {item.product_description && (
            <p className="product-spec-text small">{item.product_description}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="catalogue-page product-page half-page">
      <HalfItem item={left} num={numLeft} />
      <div className="half-divider" />
      {right
        ? <HalfItem item={right} num={numRight} />
        : <div className="half-item half-empty" />
      }
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CataloguePreview() {
  const { id } = useParams()
  const [catalogue, setCatalogue] = useState(null)
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'catalogues', id)),
      getDocs(query(collection(db, 'catalogues', id, 'items'), orderBy('sort_order'))),
    ]).then(([catSnap, itemsSnap]) => {
      if (catSnap.exists()) setCatalogue({ id: catSnap.id, ...catSnap.data() })
      setItems(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
      setLoading(false)
    })
  }, [id])

  if (loading) return <div className="p-6 text-gray-400">Loading…</div>
  if (!catalogue) return <div className="p-6 text-gray-400">Catalogue not found.</div>

  // Build pages: auto-detect layout from image count
  const pages = []
  let i = 0
  let itemNum = 1
  while (i < items.length) {
    const item = items[i]
    const layout = getLayout(item)

    if (layout === 'quarter') {
      // Collect up to 4 consecutive quarter items into one page
      const slots = [], nums = []
      while (i < items.length && getLayout(items[i]) === 'quarter' && slots.length < 4) {
        slots.push(items[i]); nums.push(itemNum); i++; itemNum++
      }
      pages.push({ type: 'quarter', slots, nums })

    } else if (layout === 'half') {
      const nextItem = items[i + 1]
      const nextIsHalf = nextItem && getLayout(nextItem) === 'half'
      pages.push({
        type: 'half',
        left: item,
        right: nextIsHalf ? nextItem : null,
        numLeft: itemNum,
        numRight: nextIsHalf ? itemNum + 1 : null,
      })
      itemNum += nextIsHalf ? 2 : 1
      i += nextIsHalf ? 2 : 1

    } else {
      pages.push({ type: 'full', item, num: itemNum })
      itemNum++; i++
    }
  }

  return (
    <>
      {/* Print controls — hidden when printing */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <Link to={`/catalogues/${id}`} className="text-sm text-brand-600 hover:underline">← Back to Builder</Link>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-500">{catalogue.name}</span>
        </div>
        <button
          onClick={() => {
            const prev = document.title
            document.title = catalogue.name
            window.print()
            setTimeout(() => { document.title = prev }, 1000)
          }}
          className="btn-primary"
        >
          🖨 Print / Save as PDF
        </button>
      </div>

      {/* Catalogue pages */}
      <div className="catalogue-wrapper catalogue-print-root">
        <style>{catalogueCSS}</style>
        <CoverPage catalogue={catalogue} />
        {pages.map((page, idx) =>
          page.type === 'full'    ? <FullPage    key={idx} item={page.item} num={page.num} /> :
          page.type === 'quarter' ? <QuarterPage key={idx} slots={page.slots} nums={page.nums} /> :
                                    <HalfPage    key={idx} left={page.left} right={page.right} numLeft={page.numLeft} numRight={page.numRight} />
        )}
      </div>
    </>
  )
}

// ── Catalogue CSS ─────────────────────────────────────────────────────────────
const catalogueCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Questrial&family=Work+Sans:wght@400;500;600&display=swap');

  /* ── Screen wrapper ── */
  .catalogue-wrapper {
    background: #e8e7e1;
    padding: 24px 0;
    margin-top: 56px;
  }

  /* ── Page shell ── */
  .catalogue-page {
    width: 297mm;
    height: 210mm;
    background: #ffffff;
    margin: 0 auto 16px;
    position: relative;
    overflow: hidden;
    display: flex;
    box-shadow: 0 4px 24px rgba(0,0,0,0.13);
    font-family: 'Questrial', 'Helvetica Neue', Arial, sans-serif;
    page-break-after: always;
    break-after: page;
    box-sizing: border-box;
  }

  /* ── Cover ── */
  .cover-page {
    background: #1a1a1a;
    align-items: flex-end;
    justify-content: flex-end;
    flex-direction: column;
  }
  .cover-inner {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
    z-index: 1;
    padding: 0 36px 36px 0;
    text-align: right;
  }
  .cover-logo {
    height: 36px;
    width: auto;
    filter: invert(1) brightness(2);
  }
  .cover-divider {
    width: 48px;
    height: 1px;
    background: rgba(200, 169, 81, 0.3);
    margin: 2px 0;
  }
  .cover-title {
    font-family: 'Questrial', Georgia, serif;
    font-size: 28px;
    font-weight: 400;
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0;
    line-height: 1.15;
  }
  .cover-season {
    font-size: 12px;
    color: rgba(200, 169, 81, 0.3);
    letter-spacing: 0.25em;
    text-transform: uppercase;
    margin: 0;
  }
  .cover-tagline {
    font-size: 16px;
    color: rgba(255,255,255,0.55);
    margin: 2px 0 0;
    font-style: italic;
  }

  /* ── Full page layout ── */
  .product-page { display: flex; }

  /* ── Full page layout ──
     Both panels use flex ratio 1.8 : 1 so top area and bottom strip
     align horizontally across the gold divider.
     Padding is kept identical top & bottom (14px) on both sides.      */
  .full-left {
    width: 62%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 12px 14px 14px;
  }
  /* Hero: upper portion, flex 2.5 */
  .fl-hero {
    flex: 2.5;
    min-height: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .fl-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Sub-row: lower strip, flex 1 (≈ 29% of panel height) */
  .fl-sub-row {
    flex: 1;
    display: flex;
    gap: 6px;
    min-height: 0;
  }
  .fl-sub-row .ig-cell { flex: 1; }

  .full-right {
    width: 38%;
    display: flex;
    flex-direction: column;
    border-left: 3px solid rgba(200, 169, 81, 0.3);
  }
  /* Text block: flex 2.5 — mirrors the hero proportion */
  .full-text-block {
    flex: 2.5;
    display: flex;
    flex-direction: column;
    padding: 14px 14px 10px 14px;
    min-height: 0;
    overflow: hidden;
  }
  /* Right image row: flex 1 — mirrors the sub-row proportion */
  .full-right-imgs {
    flex: 1;
    display: flex;
    flex-direction: row;
    gap: 8px;
    padding: 0 14px 14px 14px;
    min-height: 0;
  }
  .full-right-imgs .ig-cell { flex: 1; }

  /* ── Quarter page layout (2×2 grid) ── */
  .quarter-page {
    display: flex;
    flex-wrap: wrap;
    padding: 0;
  }
  .quarter-item {
    width: 50%;
    height: 50%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    border-right: 1px solid #e8e6e0;
    border-bottom: 1px solid #e8e6e0;
  }
  .quarter-item:nth-child(2n)   { border-right: none; }
  .quarter-item:nth-child(3),
  .quarter-item:nth-child(4)    { border-bottom: none; }
  /* Gold vertical centre divider */
  .quarter-item:nth-child(1),
  .quarter-item:nth-child(3)    { border-right: 2px solid rgba(200, 169, 81, 0.3); }
  /* Gold horizontal centre divider */
  .quarter-item:nth-child(1),
  .quarter-item:nth-child(2)    { border-bottom: 2px solid rgba(200, 169, 81, 0.3); }
  .quarter-item.quarter-empty   { background: #fafaf8; }
  /* 3-image: strict 50/50 split */
  .quarter-3 .quarter-img-area  { flex: 1; }
  .quarter-3 .quarter-content   { flex: 1; flex-shrink: unset; display: flex; flex-direction: column; justify-content: center; }

  /* 2-image: stack (image top, text bottom) */
  .quarter-img-area {
    flex: 1;
    display: flex;
    min-height: 0;
    padding: 12px 12px 6px;
  }
  .quarter-content {
    flex-shrink: 0;
    padding: 6px 14px 12px;
  }

  /* 1-image: side by side (image left, text right) */
  .quarter-item-row {
    flex-direction: row !important;
  }
  .quarter-img-side {
    width: 65%;
    display: flex;
    flex-shrink: 0;
    padding: 12px 6px 12px 12px;
    min-height: 0;
  }
  .quarter-text-side {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 14px 14px 12px 10px;
    min-width: 0;
    justify-content: center;
  }

  /* 2-image: text left, 2 images stacked vertically on right */
  .quarter-2col {
    flex-direction: row !important;
  }
  .quarter-2-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 14px 10px 12px 14px;
    min-width: 0;
    justify-content: center;
  }
  .quarter-2-imgs {
    width: 35%;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 12px 12px 6px;
    min-height: 0;
  }
  .quarter-2-imgs .ig-cell {
    flex: 1;
    min-height: 0;
  }
  .product-num.xsmall   { font-size: 10px; margin-bottom: 2px; }
  .product-name.xsmall  { font-size: 14px; margin: 0 0 2px; }
  .product-marketing.xsmall { font-size: 12px; line-height: 1.5; margin: 0; }
  .product-spec-text.xsmall { font-size: 10px; }

  /* ── Half page layout ── */
  .half-page { padding: 0; }
  .half-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .half-item.half-empty { background: #f7f6f3; }
  /* 4-image half: 65% images, 35% text */
  .half-item-4 .half-img-area {
    flex: none !important;
    height: 136.5mm;
    min-height: 136.5mm;
    max-height: 136.5mm;
    box-sizing: border-box;
  }
  .half-item-4 .half-content {
    flex: none !important;
    height: 73.5mm;
    min-height: 73.5mm;
    max-height: 73.5mm;
    box-sizing: border-box;
    overflow: hidden;
  }
  .half-img-area {
    flex: 1;
    display: flex;
    min-height: 0;
    padding: 14px 14px 8px;
  }
  .half-content {
    flex-shrink: 0;
    padding: 10px 16px 14px;
    display: flex;
    flex-direction: column;
  }
  .half-divider {
    width: 3px;
    background: rgba(200, 169, 81, 0.3);
    flex-shrink: 0;
  }

  /* ── 3-image half: vertical images left, text right ── */
  .half-3col {
    flex-direction: row;
  }
  .half-3-imgs {
    width: 46%;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 14px 6px 14px 14px;
    flex-shrink: 0;
  }
  .half-3-imgs .ig-cell {
    flex: 1;
    min-height: 0;
  }
  .half-3-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px 16px 16px 16px;
    min-width: 0;
    border-left: 1px solid #f0efe9;
  }

  /* ── Image grid system (used in half-page layouts) ── */

  /* Base grid container */
  .ig {
    flex: 1;
    display: flex;
    gap: 5px;
    min-height: 0;
    min-width: 0;
    width: 100%;
    height: 100%;
  }

  /* Column direction (3-image: hero top + 2 below) */
  .ig-col {
    flex-direction: column;
  }

  /* Sub-row below hero */
  .ig-sub {
    flex-shrink: 0;
    height: 34%;
  }

  /* 2×2 grid */
  .ig-grid2 {
    flex-wrap: wrap;
  }
  .ig-grid2 .ig-cell {
    flex: 1 1 calc(50% - 3px);
    max-width: calc(50% - 3px);
  }

  /* Individual image cell */
  .ig-cell {
    flex: 1;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
  }
  .ig-cell img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* ── Typography ── */
  .product-num {
    font-size: 13px;
    color: rgba(200, 169, 81, 0.3);
    letter-spacing: 0.2em;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .product-num.small { font-size: 12px; margin-bottom: 3px; }

  .product-name {
    font-size: 25px;
    font-weight: 600;
    color: #1a1a1a;
    line-height: 1.2;
    margin: 0 0 3px;
  }
  .product-name.small { font-size: 17px; margin: 0 0 2px; }

  .product-category {
    font-size: 11px;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    margin: 0 0 10px;
  }

  .product-divider {
    width: 28px;
    height: 1px;
    background: rgba(200, 169, 81, 0.3);
    margin-bottom: 11px;
    flex-shrink: 0;
  }

  .product-marketing {
    font-size: 15px;
    color: #444;
    line-height: 1.7;
    margin: 0 0 12px;
    flex: 1;
    overflow: hidden;
  }
  .product-marketing.small { font-size: 13px; line-height: 1.5; margin-bottom: 6px; }

  .product-spec {
    padding-top: 10px;
    border-top: 1px solid #ebebeb;
    flex-shrink: 0;
  }
  .product-spec-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #bbb;
    margin: 0 0 3px;
  }
  .product-spec-text {
    font-size: 11px;
    color: #999;
    line-height: 1.5;
    margin: 0;
    white-space: pre-line;
  }
  .product-spec-text.small { font-size: 10px; }

  .product-contact {
    margin-top: auto;
    padding-top: 10px;
    font-size: 11px;
    color: #bbb;
    font-style: italic;
    flex-shrink: 0;
  }

  /* ── Print ── */
  @media print {
    @page { size: A4 landscape; margin: 0mm; }

    /* Ensure backgrounds & images print (cover photo, overlays, gold colours) */
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: white !important;
      height: auto !important;
      overflow: visible !important;
    }

    /* Walk down the exact DOM path from Layout.jsx, un-flexing each shell */
    #root                       { display: block !important; height: auto !important; overflow: visible !important; }
    #root > div                 { display: block !important; height: auto !important; overflow: visible !important; }
    #root > div > div           { display: block !important; height: auto !important; overflow: visible !important; }

    /* Hide every direct UI sibling: sidebar, mobile header, mobile nav, print bar */
    #root > div > aside         { display: none !important; }
    #root > div > div > header  { display: none !important; }
    #root > div > div > nav     { display: none !important; }
    .no-print                   { display: none !important; }

    /* Unlock the scrollable main so all pages render */
    #root > div > div > main {
      display: block !important;
      overflow: visible !important;
      height: auto !important;
      padding: 0 !important;
    }

    .catalogue-wrapper {
      background: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .catalogue-page {
      width: 297mm !important;
      height: 210mm !important;
      margin: 0 !important;
      box-shadow: none !important;
      page-break-after: always !important;
      break-after: page !important;
      overflow: hidden !important;
    }
  }
`
