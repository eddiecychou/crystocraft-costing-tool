import { useEffect, useRef, useState } from 'react'
import logo from '../assets/logo.png'
import { catalogueCopySpace, catalogueImages, catalogueImageSize, planCataloguePages } from '../catalogueLayout'

const PAGE_WIDTH = 297 * 96 / 25.4
const PAGE_HEIGHT = 210 * 96 / 25.4

// Retain trailing whitespace in the DOM/source without allowing empty final
// lines to create an otherwise blank continuation page.
function CopyText({ text }) {
  const visible = text.trimEnd()
  return <p className="cat-copy-text">{visible}{text.length > visible.length && <span className="cat-tail-space" aria-hidden="true">{text.slice(visible.length)}</span>}</p>
}

export function CatalogueSheet({ scale, children, last = false, orientation = 'landscape' }) {
  const portrait = orientation === 'portrait'
  const sheetScale = portrait ? Math.min(1, scale * PAGE_WIDTH / PAGE_HEIGHT) : scale
  return <div className={`catalogue-sheet catalogue-sheet--${orientation}${last ? ' cat-last-sheet' : ''}`} data-orientation={orientation} style={{ width: (portrait ? PAGE_HEIGHT : PAGE_WIDTH) * sheetScale, height: (portrait ? PAGE_WIDTH : PAGE_HEIGHT) * sheetScale, '--catalogue-scale': sheetScale }}>{children}</div>
}

function ProductCopy({ entry, mode }) {
  const { item, blocks, continued } = entry
  return <div className={`cat-copy cat-copy--${mode}`} data-catalogue-copy data-product-number={entry.number}>
    {continued && <p className="cat-continued">Continued</p>}
    <h2 className="cat-product-title">{item.product_name || 'Untitled product'}</h2>
    {mode !== 'full' && item.product_category && <p className="cat-product-category">{item.product_category}</p>}
    {blocks.map((block, index) => <div className={`cat-text-block cat-text-block--${block.kind}`} data-copy-kind={block.kind} key={index}>
      {block.kind === 'spec' && <p className="cat-spec-label">Specifications{block.continued ? ' (continued)' : ''}</p>}
      <CopyText text={block.text} />
    </div>)}
  </div>
}

function Photo({ url, item }) {
  return <img src={url} alt={`${item.product_name || 'Product'} — image ${catalogueImages(item).indexOf(url) + 1}`} />
}

function ProductGallery({ entry, mode }) {
  const { images, item } = entry
  if (!images.length) return null
  if (['gallery', 'large', 'full'].includes(mode)) return <div className={`cat-photo-grid cat-photo-grid--${images.length}`}>
    {images.map((url, index) => <div className="cat-photo-cell" key={`${index}-${url}`}><Photo url={url} item={item} index={index} /></div>)}
  </div>
  return <div className={`cat-gallery cat-gallery--${mode}`}>
    <div className="cat-main-frame"><Photo url={images[0]} item={item} index={0} /></div>
  </div>
}

function PageFrame({ catalogue, pageNumber, total, children, bodyRef, measure = false, orientation = 'landscape' }) {
  return <section className={`catalogue-page cat-page cat-page--${orientation}${measure ? ' cat-measure-page' : ''}`}>
    <header className="cat-page-header"><img src={logo} alt="Crystocraft" /><span>{catalogue.name}</span></header>
    <div className="cat-page-body" ref={bodyRef}>{children}</div>
    <footer className="cat-page-footer"><span>{catalogue.season || 'Crystocraft'}</span><span>Contact us for pricing &amp; availability</span><span>{pageNumber} / {total}</span></footer>
  </section>
}

// The measurement tree uses the identical copy elements/classes as ProductCopy.
// It is off-screen (not display:none), so real font shaping, CJK, newlines and
// long unbroken specifications all contribute to the measured height.
function measureCopy(node, mode, item, blocks, continued, space) {
  node.className = `cat-copy cat-copy--${mode}`
  node.style.width = `${space.width}px`
  node.replaceChildren()
  const append = (parent, tag, className, text) => {
    const el = node.ownerDocument.createElement(tag)
    el.className = className
    el.textContent = text
    parent.append(el)
    return el
  }
  if (continued) append(node, 'p', 'cat-continued', 'Continued')
  append(node, 'h2', 'cat-product-title', item.product_name || 'Untitled product')
  if (mode !== 'full' && item.product_category) append(node, 'p', 'cat-product-category', item.product_category)
  for (const block of blocks) {
    const wrapper = append(node, 'div', `cat-text-block cat-text-block--${block.kind}`, '')
    if (block.kind === 'spec') append(wrapper, 'p', 'cat-spec-label', `Specifications${block.continued ? ' (continued)' : ''}`)
    const visible = block.text.trimEnd()
    const paragraph = append(wrapper, 'p', 'cat-copy-text', visible)
    if (visible.length < block.text.length) append(paragraph, 'span', 'cat-tail-space', block.text.slice(visible.length))
  }
  return node.getBoundingClientRect().height <= space.height - 3
}

export default function CatalogueProductPages({ catalogue, items, scale, onStatus }) {
  const bodyRef = useRef(null), portraitBodyRef = useRef(null), copyRef = useRef(null), outputRef = useRef(null)
  const [pages, setPages] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setPages(null)
    setError('')
    onStatus({ ready: false, error: '' })
    const paginate = async () => {
      try {
        if (document.fonts?.load) await Promise.all([
          document.fonts.load('14px "Catalogue Questrial"'),
          document.fonts.load('10px "Catalogue Work Sans"'),
        ])
        await document.fonts?.ready
        const fullImages = [...new Set(items.flatMap(item => catalogueImages(item).filter(url => catalogueImageSize(item, url) === 'full')))]
        const imageDimensions = Object.fromEntries(await Promise.all(fullImages.map(url => new Promise((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve([url, { width: image.naturalWidth, height: image.naturalHeight }])
          image.onerror = () => reject(new Error('A catalogue image could not load. Please reopen the preview or replace the unavailable image.'))
          image.src = url
        }))))
        if (cancelled) return
        const fits = (mode, item, blocks, continued, orientation = 'landscape') => {
          const body = (orientation === 'portrait' ? portraitBodyRef : bodyRef).current.getBoundingClientRect()
          return measureCopy(copyRef.current, mode, item, blocks, continued, catalogueCopySpace(mode, body.width, body.height, Boolean(catalogueImages(item).length)))
        }
        const result = planCataloguePages(items, fits, imageDimensions)
        if (!cancelled) setPages(result)
      } catch (err) {
        if (!cancelled) { setError(err.message); onStatus({ ready: false, error: err.message }) }
      }
    }
    paginate()
    return () => { cancelled = true }
  }, [items, onStatus])

  useEffect(() => {
    if (!pages) return
    let cancelled = false
    const verify = async () => {
      try {
        const root = outputRef.current.closest('.catalogue-print-root')
        await Promise.all(Array.from(root.querySelectorAll('.catalogue-sheet img')).map(async img => {
          if (img.decode) await img.decode().catch(() => { throw new Error('A catalogue image could not load. Please reopen the preview or replace the unavailable image.') })
          else if (!img.complete) await new Promise((resolve, reject) => {
            img.addEventListener('load', resolve, { once: true })
            img.addEventListener('error', reject, { once: true })
          })
          if (!img.naturalWidth) throw new Error('A catalogue image could not load.')
        }))
        if (cancelled) return
        // Final readback uses unscaled geometry. Parent transforms scale both
        // bounds equally, so this also works in a phone-sized preview.
        for (const copy of root.querySelectorAll('.catalogue-sheet [data-catalogue-copy]')) {
          const rect = copy.getBoundingClientRect(), body = copy.closest('.cat-page-body').getBoundingClientRect()
          if (rect.bottom > body.bottom + 1 || rect.right > body.right + 1 || copy.scrollWidth > copy.clientWidth + 1 || copy.scrollHeight > copy.clientHeight + 1) {
            throw new Error('Some product text does not fit. Printing is paused to prevent clipped specifications. Please reopen the preview.')
          }
        }
        onStatus({ ready: true, error: '', pages: pages.length + 1 })
      } catch (err) {
        if (!cancelled) onStatus({ ready: false, error: err.message || 'A catalogue image could not load. Please reopen the preview.' })
      }
    }
    verify()
    return () => { cancelled = true }
  }, [pages, onStatus, scale])

  return <>
    <div className="cat-measure" aria-hidden="true" inert="">
      <PageFrame catalogue={catalogue} bodyRef={bodyRef} measure><div ref={copyRef} /></PageFrame>
      <PageFrame catalogue={catalogue} bodyRef={portraitBodyRef} measure orientation="portrait" />
    </div>
    {error && <p className="no-print cat-layout-error" role="alert">{error}</p>}
    <div className="cat-product-pages" ref={outputRef}>
      {pages?.map((page, index) => <CatalogueSheet key={index} scale={scale} last={index === pages.length - 1} orientation={page.orientation}>
        <PageFrame catalogue={catalogue} pageNumber={index + 2} total={pages.length + 1} orientation={page.orientation}>
          {page.type === 'overview' || page.type === 'standard'
            ? <div className={`cat-products cat-products--${page.type}`}>
              {page.entries.map(entry => <article key={entry.number} className={`cat-product cat-product--${page.type}`}>
                <ProductGallery entry={entry} mode={page.type} />
                <ProductCopy entry={entry} mode={page.type} />
              </article>)}
            </div>
            : <article className={`cat-single cat-single--${page.type}`}>
              {['gallery', 'large', 'full'].includes(page.type)
                ? <><ProductCopy entry={page.entries[0]} mode={page.type} /><ProductGallery entry={page.entries[0]} mode={page.type} /></>
                : <><ProductGallery entry={page.entries[0]} mode={page.type} /><ProductCopy entry={page.entries[0]} mode={page.type} /></>}
            </article>}
        </PageFrame>
      </CatalogueSheet>)}
    </div>
  </>
}
