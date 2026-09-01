import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db, auth } from '../../firebase'
import { ArrowLeft, Upload, Sparkles, Check, Gem, AlertTriangle } from 'lucide-react'
import { useCart } from '../store'
import {
  CRYSTAL_TYPES, MODES, styleOfType, typeLabel, PRINTED_MODE_COLORS,
  fileToPngDataUrl, renderPreview, saveDesign, fetchPalette,
} from '../../customizerApi'

const DEFAULTS = {
  mode: 'zone_map', crystal_type: 'fine_rock_1.5',
  // zone_map only — the background's own stone SIZE, independent of the
  // logo's crystal_type (a real product can be e.g. a Jet Fine Rock logo on
  // a Crystal AB Fabric 1mm background). Defaults to fabric_1.0 to match
  // what the engine already defaulted to before this was selectable.
  bg_crystal_type: 'fabric_1.0',
  fg_color: '', bg_color: '', message: '', panel_mm: 80,
}

// Crystal-fabric customization engine. Receives the product (loaded by the
// dispatcher); loads its own optional product_templates config. The colour
// palette is fetched live from the render service — see customizerApi.js's
// fetchPalette for why it's not hard-coded here.
export default function CrystalFabricCustomizer({ product, profile }) {
  const nav = useNavigate()
  const cart = useCart()
  const productId = product.id

  const [tmpl, setTmpl] = useState(null)
  const [palette, setPalette] = useState([])
  const [paletteError, setPaletteError] = useState('')
  const [paletteLoading, setPaletteLoading] = useState(true)
  const [sel, setSel] = useState(DEFAULTS)
  const [logoDataUrl, setLogoDataUrl] = useState(null)
  const [logoName, setLogoName] = useState('')
  const [previewUrl, setPreviewUrl] = useState(null)
  const [rendering, setRendering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lastBlob = useRef(null)

  useEffect(() => {
    fetchPalette()
      .then(setPalette)
      .catch(e => setPaletteError(e.message || 'Could not load the crystal palette.'))
      .finally(() => setPaletteLoading(false))
  }, [])

  // Optional per-product template (crystal types / palette / defaults).
  useEffect(() => {
    getDoc(doc(db, 'product_templates', productId)).then(s => {
      if (!s.exists()) return
      const t = s.data(); setTmpl(t)
      setSel(p => ({
        ...p,
        mode: t.mode || p.mode,
        crystal_type: t.defaults?.crystal_type || p.crystal_type,
        bg_crystal_type: t.defaults?.bg_crystal_type || p.bg_crystal_type,
        fg_color: t.defaults?.fg || p.fg_color,
        bg_color: t.defaults?.bg || p.bg_color,
        panel_mm: t.panel_mm || p.panel_mm,
      }))
    }).catch(() => {})
  }, [productId])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const crystalTypes = CRYSTAL_TYPES.filter(t => !tmpl?.crystal_types || tmpl.crystal_types.includes(t.value))
  const isZone = sel.mode === 'zone_map'
  const style = styleOfType(sel.crystal_type)           // logo's stone style
  const bgStyle = styleOfType(sel.bg_crystal_type)       // background's own stone style (zone_map only)

  // Colours photographed for the LOGO's stone style, permitted by the
  // product template if it restricts the palette. printed mode is further
  // restricted to PRINTED_MODE_COLORS — only Crystal AB is a genuinely
  // transparent/coated crystal; every other captured colour is opaque or
  // metallic-coated and would hide the graphic underneath in the real
  // product (owner, 2026-08-06), even though the render engine has no
  // physical "transparency" flag and would technically produce an image.
  const fgAvailColors = useMemo(() => {
    let list = palette.filter(c => (c[style] || []).length > 0)
    if (tmpl?.palette) list = list.filter(c => tmpl.palette.includes(c.name))
    if (!isZone) list = list.filter(c => PRINTED_MODE_COLORS.includes(c.name))
    return list
  }, [palette, style, tmpl, isZone])

  // zone_map only: colours photographed for the BACKGROUND's own stone
  // style — can differ from the logo's (e.g. logo in Fine Rock, background
  // in Fabric 1mm), so this is filtered separately from fgAvailColors.
  const bgAvailColors = useMemo(() => {
    let list = palette.filter(c => (c[bgStyle] || []).length > 0)
    if (tmpl?.palette) list = list.filter(c => tmpl.palette.includes(c.name))
    return list
  }, [palette, bgStyle, tmpl])

  const set = patch => { setSel(p => ({ ...p, ...patch })); setPreviewUrl(null); lastBlob.current = null }

  // Keep the colour selections valid as mode/type/palette change — a stale
  // pick would render an error. Snap to the first available option. printed
  // mode has no background pick at all (the graphic itself is the
  // backfilm — see customizerApi.js's MODES), only fg matters there.
  useEffect(() => {
    if (!palette.length) return
    const fgNames = fgAvailColors.map(c => c.name)
    if (!fgNames.length) return
    const fg = fgNames.includes(sel.fg_color) ? sel.fg_color : fgNames[0]
    const bg = isZone
      ? (bgAvailColors.map(c => c.name).includes(sel.bg_color) ? sel.bg_color : (bgAvailColors[0]?.name || ''))
      : ''
    if (fg !== sel.fg_color || bg !== sel.bg_color) {
      setSel(p => ({ ...p, fg_color: fg, bg_color: bg }))
      setPreviewUrl(null); lastBlob.current = null
    }
  }, [palette, fgAvailColors, bgAvailColors, isZone, sel.fg_color, sel.bg_color])

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

  const colorHex = name => (palette.find(c => c.name === name) || {}).hex || '#ccc'
  const noColors = !paletteLoading && !paletteError && fgAvailColors.length === 0

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
          <div className="card aspect-square bg-ivory-dark flex items-center justify-center overflow-hidden relative">
            {previewUrl
              ? <img src={previewUrl} alt="Crystal preview" className="w-full h-full object-cover" />
              : (
                <div className="text-center text-ink-60 px-6">
                  <Gem size={40} className="mx-auto mb-2 text-platinum" />
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
          <p className="text-[11px] text-ink-60 mt-2 flex items-start gap-1">
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
            {logoName && <p className="text-xs text-ink-60 mt-1.5 truncate">{logoName}</p>}
            <p className="text-[11px] text-ink-60 mt-1.5">
              Best results: a bold, high-contrast logo. A transparent PNG works best; fine
              lines and small text may not survive in crystals.
            </p>
          </Section>

          <Section title="2. Style">
            <div className="grid grid-cols-1 gap-2">
              {MODES.filter(m => m.available).map(m => (
                <button key={m.value} type="button" onClick={() => set({ mode: m.value })}
                  className={`text-left p-2.5 rounded-lg border text-sm transition-colors ${
                    sel.mode === m.value ? 'border-brand-400 bg-brand-50' : 'border-ivory-dark hover:bg-ivory'}`}>
                  <span className="font-medium text-ink">{m.label}</span>
                  <span className="block text-[11px] text-ink-60 mt-0.5">{m.desc}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title={isZone ? '3. Logo crystal type' : '3. Crystal type'}>
            <div className="grid grid-cols-1 gap-2">
              {crystalTypes.map(t => (
                <button key={t.value} type="button" onClick={() => set({ crystal_type: t.value })}
                  className={`text-left p-2.5 rounded-lg border text-sm transition-colors ${
                    sel.crystal_type === t.value ? 'border-brand-400 bg-brand-50' : 'border-ivory-dark hover:bg-ivory'}`}>
                  <span className="font-medium text-ink">{t.label} <span className="text-ink-60 font-normal">{t.mm}</span></span>
                  <span className="block text-[11px] text-ink-60 mt-0.5">{t.hint}</span>
                </button>
              ))}
            </div>
          </Section>

          {isZone && (
            <Section title="4. Background crystal type">
              <p className="text-[11px] text-ink-60 mb-2">
                Can be a different stone size to the logo — e.g. a fine logo on a coarser sparkling background.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {CRYSTAL_TYPES.map(t => (
                  <button key={t.value} type="button" onClick={() => set({ bg_crystal_type: t.value })}
                    className={`text-left p-2.5 rounded-lg border text-sm transition-colors ${
                      sel.bg_crystal_type === t.value ? 'border-brand-400 bg-brand-50' : 'border-ivory-dark hover:bg-ivory'}`}>
                    <span className="font-medium text-ink">{t.label} <span className="text-ink-60 font-normal">{t.mm}</span></span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title={isZone ? '5. Crystal colours' : '4. Crystal colour'}>
            {paletteLoading && <p className="text-sm text-ink-60">Loading colours…</p>}
            {paletteError && <p className="text-sm text-red-600">{paletteError}</p>}
            {noColors && (
              <p className="text-sm text-ink-60">
                {isZone ? 'No crystal colours are available for this stone type yet.'
                  : 'Crystal AB isn’t captured for this stone type yet — try a different crystal type above.'}
              </p>
            )}
            {!paletteLoading && !paletteError && fgAvailColors.length > 0 && (
              <>
                {!isZone && (
                  <p className="text-[11px] text-ink-60 mb-2">
                    Only Crystal AB is transparent enough to show your graphic through it — the other captured colours are opaque or metallic-coated.
                  </p>
                )}
                <Swatches label={isZone ? 'Logo crystals' : 'Crystal layer (transparent top)'}
                  value={sel.fg_color} palette={fgAvailColors} colorHex={colorHex}
                  onChange={name => set({ fg_color: name })} />
                {isZone && (
                  <div className="mt-3">
                    {bgAvailColors.length > 0 ? (
                      <Swatches label="Background crystals"
                        value={sel.bg_color} palette={bgAvailColors} colorHex={colorHex}
                        onChange={name => set({ bg_color: name })} />
                    ) : (
                      <p className="text-[11px] text-ink-60">No crystal colours captured for this background stone type yet — pick another type above.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </Section>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={updatePreview} disabled={rendering || !logoDataUrl || noColors || !!paletteError || (isZone && bgAvailColors.length === 0)} className="btn-primary">
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
      <h2 className="text-xs font-label uppercase tracking-wide text-ink-60 mb-2">{title}</h2>
      {children}
    </div>
  )
}

function Swatches({ label, value, palette, colorHex, onChange }) {
  return (
    <div>
      <p className="text-xs text-ink-60 mb-1.5">{label}: <span className="text-ink">{value || '—'}</span></p>
      <div className="flex flex-wrap gap-1.5">
        {palette.map(c => (
          <button key={c.name} type="button" title={c.name} onClick={() => onChange(c.name)}
            className={`w-7 h-7 rounded-full border-2 transition ${
              value === c.name ? 'border-brand-500 ring-2 ring-brand-200' : 'border-white shadow-sm'}`}
            style={{ background: colorHex(c.name) }} />
        ))}
      </div>
    </div>
  )
}
