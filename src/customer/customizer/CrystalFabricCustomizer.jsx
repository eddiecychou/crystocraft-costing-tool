import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db, auth } from '../../firebase'
import { ArrowLeft, Upload, Sparkles, Check, Gem, AlertTriangle } from 'lucide-react'
import { useCart } from '../store'
import {
  CRYSTAL_COLORS, CRYSTAL_TYPES, MODES, colorHex, colorLabel, typeLabel,
  fileToPngDataUrl, renderPreview, saveDesign,
} from '../../customizerApi'

const DEFAULTS = {
  mode: 'zone_map', crystal_type: 'fine_rock_1.5',
  fg_color: 'Jet', bg_color: 'White', message: '', panel_mm: 80,
}

// Crystal-fabric customization engine. Receives the product (loaded by the
// dispatcher); loads its own optional product_templates config.
export default function CrystalFabricCustomizer({ product, profile }) {
  const nav = useNavigate()
  const cart = useCart()
  const productId = product.id

  const [tmpl, setTmpl] = useState(null)
  const [sel, setSel] = useState(DEFAULTS)
  const [logoDataUrl, setLogoDataUrl] = useState(null)
  const [logoName, setLogoName] = useState('')
  const [previewUrl, setPreviewUrl] = useState(null)
  const [rendering, setRendering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lastBlob = useRef(null)

  // Optional per-product template (crystal types / palette / defaults).
  useEffect(() => {
    getDoc(doc(db, 'product_templates', productId)).then(s => {
      if (!s.exists()) return
      const t = s.data(); setTmpl(t)
      setSel(p => ({
        ...p,
        mode: t.mode || p.mode,
        crystal_type: t.defaults?.crystal_type || p.crystal_type,
        fg_color: t.defaults?.fg || p.fg_color,
        bg_color: t.defaults?.bg || p.bg_color,
        panel_mm: t.panel_mm || p.panel_mm,
      }))
    }).catch(() => {})
  }, [productId])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const crystalTypes = CRYSTAL_TYPES.filter(t => !tmpl?.crystal_types || tmpl.crystal_types.includes(t.value))
  const palette = CRYSTAL_COLORS.filter(c => !tmpl?.palette || tmpl.palette.includes(c.name))
  const set = patch => { setSel(p => ({ ...p, ...patch })); setPreviewUrl(null); lastBlob.current = null }

  async function onLogo(file) {
    if (!file) return
    setError('')
    try {
      const url = await fileToPngDataUrl(file)
      setLogoDataUrl(url); setLogoName(file.name)
      setPreviewUrl(null); lastBlob.current = null
    } catch { setError('Could not read that image — try a PNG or JPG.') }
  }

  async function updatePreview() {
    if (!logoDataUrl) { setError('Upload your logo first.'); return }
    setRendering(true); setError('')
    try {
      const blob = await renderPreview({ ...sel, logo_png_b64: logoDataUrl.split(',')[1] })
      lastBlob.current = blob
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (e) { setError(e.message || 'Preview failed — please try again.') }
    finally { setRendering(false) }
  }

  async function addToEnquiry() {
    if (!lastBlob.current) { setError('Generate a preview first.'); return }
    setSaving(true); setError('')
    try {
      const uid = profile?.id || auth.currentUser?.uid
      const { id, render_url } = await saveDesign({
        uid, customerId: profile?.customer_id, productId,
        selections: { ...sel, engine: 'crystal_fabric' }, renderBlob: lastBlob.current, logoDataUrl,
      })
      cart.add({
        type: 'custom', id,
        name: `Custom ${product?.name || 'crystal gift'} — ${typeLabel(sel.crystal_type)}`,
        code: '', image: render_url, qty: 1,
      })
      nav('/shop/enquiry')
    } catch (e) { setError('Could not save your design — please try again.') }
    finally { setSaving(false) }
  }

  const isZone = sel.mode === 'zone_map'

  return (
    <div>
      <Link to={`/shop/corporate/${product.id}`} className="inline-flex items-center gap-1 text-sm text-ink-60 hover:text-ink mb-4">
        <ArrowLeft size={15} /> Back to {product.name}
      </Link>

      <h1 className="text-xl md:text-2xl text-ink mb-1">Customise &amp; Preview</h1>
      <p className="text-sm text-ink-60 mb-5">
        Upload your logo, choose crystals, and generate a preview to share for sign-off.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Preview */}
        <div className="md:sticky md:top-4 self-start">
          <div className="card aspect-square bg-gray-100 flex items-center justify-center overflow-hidden relative">
            {previewUrl
              ? <img src={previewUrl} alt="Crystal preview" className="w-full h-full object-cover" />
              : (
                <div className="text-center text-ink-40 px-6">
                  <Gem size={40} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Your crystal preview appears here.</p>
                  <p className="text-xs mt-1">Upload a logo, then “Generate preview”.</p>
                </div>
              )}
            {rendering && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                <span className="inline-flex items-center gap-2 text-sm text-ink-70">
                  <span className="w-4 h-4 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
                  Rendering crystals…
                </span>
              </div>
            )}
          </div>
          <p className="text-[11px] text-ink-40 mt-2 flex items-start gap-1">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            Indicative preview — final crystal artwork is confirmed by our team before production.
          </p>
        </div>

        {/* Controls */}
        <div className="space-y-5">
          <Section title="1. Your logo">
            <label className="flex items-center gap-2 btn-secondary text-sm cursor-pointer w-fit">
              <Upload size={15} /> {logoName ? 'Change logo' : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={e => onLogo(e.target.files?.[0])} />
            </label>
            {logoName && <p className="text-xs text-ink-50 mt-1.5 truncate">{logoName}</p>}
            <p className="text-[11px] text-ink-40 mt-1.5">
              Best results: a bold, high-contrast logo. A transparent PNG works best; fine
              lines and small text may not survive in crystals.
            </p>
          </Section>

          <Section title="2. Style">
            <div className="grid grid-cols-1 gap-2">
              {MODES.map(m => (
                <button key={m.value} type="button" onClick={() => set({ mode: m.value })}
                  className={`text-left p-2.5 rounded-lg border text-sm transition-colors ${
                    sel.mode === m.value ? 'border-brand-400 bg-brand-50' : 'border-ivory-dark hover:bg-gray-50'}`}>
                  <span className="font-medium text-ink">{m.label}</span>
                  <span className="block text-[11px] text-ink-50 mt-0.5">{m.desc}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="3. Crystal type">
            <div className="grid grid-cols-1 gap-2">
              {crystalTypes.map(t => (
                <button key={t.value} type="button" onClick={() => set({ crystal_type: t.value })}
                  className={`text-left p-2.5 rounded-lg border text-sm transition-colors ${
                    sel.crystal_type === t.value ? 'border-brand-400 bg-brand-50' : 'border-ivory-dark hover:bg-gray-50'}`}>
                  <span className="font-medium text-ink">{t.label} <span className="text-ink-50 font-normal">{t.mm}</span></span>
                  <span className="block text-[11px] text-ink-50 mt-0.5">{t.hint}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="4. Crystal colours">
            <Swatches label={isZone ? 'Logo crystals' : 'Printed graphic'}
              value={isZone ? sel.fg_color : sel.bg_color} palette={palette}
              onChange={name => set(isZone ? { fg_color: name } : { bg_color: name })} />
            <div className="mt-3">
              <Swatches label={isZone ? 'Background crystals' : 'Crystal layer (transparent)'}
                value={isZone ? sel.bg_color : sel.fg_color} palette={palette}
                onChange={name => set(isZone ? { bg_color: name } : { fg_color: name })} />
            </div>
          </Section>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={updatePreview} disabled={rendering || !logoDataUrl} className="btn-primary">
              <Sparkles size={16} /> {rendering ? 'Rendering…' : previewUrl ? 'Update preview' : 'Generate preview'}
            </button>
            <button onClick={addToEnquiry} disabled={saving || !previewUrl} className="btn-secondary">
              {saving ? 'Saving…' : <><Check size={16} /> Add to enquiry</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-xs font-label uppercase tracking-wide text-ink-50 mb-2">{title}</h2>
      {children}
    </div>
  )
}

function Swatches({ label, value, palette, onChange }) {
  return (
    <div>
      <p className="text-xs text-ink-60 mb-1.5">{label}: <span className="text-ink">{colorLabel(value)}</span></p>
      <div className="flex flex-wrap gap-1.5">
        {palette.map(c => (
          <button key={c.name} type="button" title={c.label} onClick={() => onChange(c.name)}
            className={`w-7 h-7 rounded-full border-2 transition ${
              value === c.name ? 'border-brand-500 ring-2 ring-brand-200' : 'border-white shadow-sm'}`}
            style={{ background: colorHex(c.name) }} />
        ))}
      </div>
    </div>
  )
}
