import { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useFrontPageFeatured, saveFrontPageFeatured, replaceFrontPageFeatured } from '../frontPageFeatured'
import { normGallery } from '../constants'
import FrontPageProductPicker from '../components/FrontPageProductPicker'
import LoadingBar from '../components/LoadingBar'
import ConfirmDialog from '../components/ConfirmDialog'
import { ChevronUp, ChevronDown, Plus, Trash2, Image as ImageIcon } from 'lucide-react'

// Homepage (/shop) "Featured Products" — 8+ hand-picked showcase cards, each
// a specific product AND a specific one of its own photos (owner,
// 2026-08-11). See src/frontPageFeatured.js for the storage shape and
// src/components/FrontPageProductPicker.jsx for the product+photo picker.
export default function FrontPageConfig({ embedded = false }) {
  const cfg = useFrontPageFeatured()
  const [products, setProducts] = useState(null) // id+type -> {name, cat} lookup for the list display
  const [pickerFor, setPickerFor] = useState(null) // null | 'new' | original featured card
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    Promise.all([getDocs(collection(db, 'range_products')), getDocs(collection(db, 'products'))])
      .then(([rangeSnap, corpSnap]) => {
        const map = {}
        rangeSnap.docs.forEach(d => {
          const p = d.data()
          map[`range:${d.id}`] = { name: p.design_name || p.description || p.design_code || d.id, image: normGallery(p.gallery)[0]?.url || '' }
        })
        corpSnap.docs.forEach(d => {
          const p = d.data()
          map[`corp_gift:${d.id}`] = { name: p.name || d.id, image: p.heroImage || '' }
        })
        setProducts(map)
      })
  }, [])

  const items = cfg?.items || []

  async function persist(next) {
    setStatus('saving')
    try {
      await saveFrontPageFeatured(next)
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? null : s)), 2000)
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'could not save'))
    }
  }

  async function handlePicked({ product_type, product_id, image_url }) {
    if (pickerFor === 'new') {
      await saveFrontPageFeatured([...items, { product_id, product_type, image_url }])
    } else {
      await replaceFrontPageFeatured(pickerFor, { product_id, product_type, image_url })
    }
    setStatus('saved')
    setPickerFor(null)
  }

  function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    persist(next)
  }

  function remove(id) {
    persist(items.filter(it => it.id !== id))
    setConfirmRemove(null)
  }

  if (cfg === null || products === null) return <LoadingBar />

  return (
    <div className={embedded ? 'p-4 md:p-6' : 'p-4 md:p-6 max-w-4xl'}>
      {!embedded && <h1 className="text-xl md:text-2xl mb-1">Front Page Configuration</h1>}
      <p className="text-sm text-ink-60 mb-1">
        Hand-picked products shown in the "Featured Products" section on the customer portal homepage (/shop) — pick which product, and which one of its own photos, to show.
      </p>
      {status === 'saving' && <p className="text-xs text-ink-60 mb-4">Saving…</p>}
      {status === 'saved' && <p className="text-xs text-emerald-600 mb-4">Saved.</p>}
      {status && typeof status === 'string' && status.startsWith('Error') && <p className="text-xs text-red-600 mb-4">{status}</p>}
      {!status && <div className="mb-4" />}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {items.map((it, i) => {
          const meta = products[`${it.product_type}:${it.product_id}`]
          return (
            <div key={it.id} className="card overflow-hidden">
              <button type="button" onClick={() => setPickerFor(it)} aria-label={`Change display image for ${meta?.name || 'featured product'}`}
                className="block w-full aspect-square bg-ivory-dark overflow-hidden focus-visible:outline-brand-600">
                <img src={it.image_url} alt="" className="w-full h-full object-cover" />
              </button>
              <div className="p-3">
                <p className="text-sm text-ink truncate" title={meta?.name}>{meta?.name || '(product not found)'}</p>
                <p className="text-2xs text-ink-60 uppercase tracking-wide mb-2">{it.product_type === 'range' ? 'Figurine' : 'Corporate'}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1 rounded-none border border-ivory-dark text-ink-60 hover:text-ink disabled:opacity-30" title="Move earlier">
                    <ChevronUp size={13} />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1}
                    className="p-1 rounded-none border border-ivory-dark text-ink-60 hover:text-ink disabled:opacity-30" title="Move later">
                    <ChevronDown size={13} />
                  </button>
                  <button type="button" onClick={() => setPickerFor(it)}
                    className="inline-flex min-h-9 items-center gap-1.5 px-2 border border-warm-grey text-xs text-brand-600 hover:bg-ivory">
                    <ImageIcon size={15} aria-hidden="true" /> Change image
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(it.id)}
                    className="p-1 rounded-none border border-ivory-dark text-ink-60 hover:text-red-600 ml-auto" title="Remove">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        <button type="button" onClick={() => setPickerFor('new')}
          className="card border-dashed flex flex-col items-center justify-center gap-2 py-10 text-ink-60 hover:text-brand-600 hover:border-brand-300 transition-colors">
          <Plus size={22} />
          <span className="text-sm">Add product</span>
        </button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-ink-60">No featured products yet — click "Add product" to pick your first one.</p>
      )}

      {pickerFor && (
        <FrontPageProductPicker initialProduct={pickerFor === 'new' ? null : {
          id: pickerFor.product_id, type: pickerFor.product_type,
          name: products[`${pickerFor.product_type}:${pickerFor.product_id}`]?.name || pickerFor.product_id,
        }} currentImage={pickerFor.image_url} onSelect={handlePicked} onClose={() => setPickerFor(null)} />
      )}

      {confirmRemove && (
        <ConfirmDialog
          message="Remove this product from the homepage Featured Products section?"
          onConfirm={() => remove(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}
