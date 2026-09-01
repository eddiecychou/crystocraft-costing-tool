import { useState, useEffect, useRef, useCallback } from 'react'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'   // required — positions the cropper; not auto-injected
import { RotateCcw, RotateCw, Crop as CropIcon } from 'lucide-react'
import { getCroppedCanvas, ASPECTS } from '../imageCrop'

// ── Pure pixel transforms (exported for headless testing) ───────────────────
// All operate in place on a Uint8ClampedArray of RGBA pixels.

// Warmth: -100 (cooler/bluer) … +100 (warmer/oranger). Scales the red channel
// up and the blue channel down (and vice-versa), leaving green as the anchor.
export function applyWarmth(data, warmth) {
  if (!warmth) return data
  const f = warmth / 100 * 0.35            // max ±35% channel shift
  const rMul = 1 + f
  const bMul = 1 - f
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = clamp255(data[i]     * rMul)
    data[i + 2] = clamp255(data[i + 2] * bMul)
  }
  return data
}

// Unsharp mask: amount 0…100. Sharpens by adding back a scaled high-pass
// (original − blurred). Uses a fast 3×3 box blur as the low-pass.
export function applySharpen(data, amount, w, h) {
  if (!amount) return data
  const k = amount / 100 * 1.5             // strength
  const src = new Uint8ClampedArray(data)  // copy of originals
  const idx = (x, y) => (y * w + x) * 4
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = idx(x, y)
      for (let c = 0; c < 3; c++) {        // R,G,B (skip alpha)
        let sum = 0, n = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            sum += src[idx(xx, yy) + c]; n++
          }
        }
        const blur = sum / n
        data[o + c] = clamp255(src[o + c] + (src[o + c] - blur) * k)
      }
    }
  }
  return data
}

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v }

// Neutral (no-op) settings.
export const NEUTRAL = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, sharpness: 0 }

export function isNeutral(s) {
  return s.brightness === 100 && s.contrast === 100 && s.saturation === 100 && s.warmth === 0 && s.sharpness === 0
}

// ── Editor component ────────────────────────────────────────────────────────
// Renders a live before/after with sliders. Emits the adjusted image as a JPEG
// data URL via onResult so the parent's existing Keep / Save-as-new pipeline
// (which fetches a data URL) works unchanged.
export default function ManualAdjust({ src, onResult, disabled }) {
  const [s, setS]     = useState(NEUTRAL)
  const [img, setImg] = useState(null)        // original loaded image (CORS-clean)
  const [loadedSrc, setLoadedSrc] = useState(src)  // the URL that actually loaded
  const [base, setBase] = useState(null)      // { img, src } after crops (else null → original)
  const [error, setError] = useState('')
  const canvasRef = useRef(null)
  const rafRef    = useRef(0)

  // Crop/rotate mode state
  const [cropMode, setCropMode]   = useState(false)
  const [aspectKey, setAspectKey] = useState('square')
  const [crop, setCrop]           = useState({ x: 0, y: 0 })
  const [zoom, setZoom]           = useState(1)
  const [quarter, setQuarter]     = useState(0)     // 0/90/180/270 from the rotate buttons
  const [straighten, setStraighten] = useState(0)   // -45…45 fine tilt
  const [areaPixels, setAreaPixels] = useState(null)
  const rotation = ((quarter + straighten) % 360 + 360) % 360

  const baseImg = base?.img || img
  const baseSrc = base?.src || loadedSrc

  // Load the source as a CORS-enabled <img> (the same approach urlToResizedBase64
  // uses — Storage URLs are CORS-readable this way, unlike a bare fetch()). On
  // failure, retry through the same-origin image proxy so the canvas stays clean.
  useEffect(() => {
    let cancelled = false
    setError(''); setImg(null); setBase(null)
    const load = (url, isFallback) => {
      const i = new Image()
      i.crossOrigin = 'anonymous'
      i.onload  = () => { if (!cancelled) { setImg(i); setLoadedSrc(url) } }
      i.onerror = () => {
        if (cancelled) return
        if (!isFallback) load(`/api/image-proxy?url=${encodeURIComponent(src)}`, true)
        else setError('Could not load image for editing.')
      }
      i.src = url
    }
    load(src, false)
    return () => { cancelled = true }
  }, [src])

  // Render pipeline: filters (brightness/contrast/saturation) via ctx.filter,
  // then warmth + sharpen as pixel passes. Runs on the current base (post-crop).
  const render = useCallback(() => {
    const el = baseImg, canvas = canvasRef.current
    if (!el || !canvas || cropMode) return
    const iw = el.naturalWidth, ih = el.naturalHeight
    const max = 1400
    const scale = Math.min(1, max / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.filter = `brightness(${s.brightness}%) contrast(${s.contrast}%) saturate(${s.saturation}%)`
    ctx.drawImage(el, 0, 0, w, h)
    ctx.filter = 'none'
    if (s.warmth || s.sharpness) {
      const imgData = ctx.getImageData(0, 0, w, h)
      applyWarmth(imgData.data, s.warmth)
      applySharpen(imgData.data, s.sharpness, w, h)
      ctx.putImageData(imgData, 0, 0)
    }
    onResult?.(canvas.toDataURL('image/jpeg', 0.92))
  }, [baseImg, s, onResult, cropMode])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafRef.current)
  }, [render])

  function openCrop() {
    setAspectKey('square'); setCrop({ x: 0, y: 0 }); setZoom(1)
    setQuarter(0); setStraighten(0); setAreaPixels(null)
    setCropMode(true)
  }

  function applyCrop() {
    if (!baseImg || !areaPixels) { setCropMode(false); return }
    const canvas = getCroppedCanvas(baseImg, areaPixels, rotation)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const next = new Image()
    next.onload = () => { setBase({ img: next, src: dataUrl }); setCropMode(false) }
    next.src = dataUrl
  }

  const set = (key) => (e) => setS(prev => ({ ...prev, [key]: Number(e.target.value) }))

  const sliders = [
    { key: 'brightness', label: 'Brightness', min: 50,   max: 150, mid: 100 },
    { key: 'contrast',   label: 'Contrast',   min: 50,   max: 150, mid: 100 },
    { key: 'saturation', label: 'Saturation', min: 0,    max: 200, mid: 100 },
    { key: 'warmth',     label: 'Warmth',     min: -100, max: 100, mid: 0   },
    { key: 'sharpness',  label: 'Sharpness',  min: 0,    max: 100, mid: 0   },
  ]
  const aspect = ASPECTS.find(a => a.key === aspectKey)?.value

  // ── Crop & rotate view ────────────────────────────────────────────────────
  if (cropMode) {
    return (
      <div>
        <div className="relative w-full h-72 bg-ink rounded-none overflow-hidden">
          <Cropper
            image={baseSrc}
            crop={crop} zoom={zoom} rotation={rotation} aspect={aspect}
            restrictPosition={false}
            onCropChange={setCrop} onZoomChange={setZoom}
            onCropComplete={(_, px) => setAreaPixels(px)}
          />
        </div>

        {/* Aspect presets */}
        <div className="mt-3 flex flex-wrap gap-2">
          {ASPECTS.map(a => (
            <button key={a.key} type="button" onClick={() => setAspectKey(a.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                aspectKey === a.key ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-warm-grey text-ink-60 hover:border-warm-grey'
              }`}>{a.label}</button>
          ))}
        </div>

        {/* Rotate + straighten */}
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setQuarter(q => (q + 270) % 360)} title="Rotate left"
            className="p-1.5 rounded-none border border-warm-grey text-ink-60 hover:border-warm-grey"><RotateCcw size={15} /></button>
          <button type="button" onClick={() => setQuarter(q => (q + 90) % 360)} title="Rotate right"
            className="p-1.5 rounded-none border border-warm-grey text-ink-60 hover:border-warm-grey"><RotateCw size={15} /></button>
          <label className="text-xs font-medium text-ink-60 shrink-0 ml-1">Straighten</label>
          <input type="range" min={-45} max={45} value={straighten}
            onChange={e => setStraighten(Number(e.target.value))} className="flex-1 accent-brand-600" />
          <span className={`w-10 text-right text-xs tabular-nums ${straighten === 0 ? 'text-ink-60' : 'text-ink-80 font-medium'}`}>
            {straighten > 0 ? `+${straighten}` : straighten}°
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => setCropMode(false)} className="btn-secondary text-sm">Cancel</button>
          <div className="flex-1" />
          <button type="button" onClick={applyCrop} disabled={!areaPixels} className="btn-primary text-sm inline-flex items-center gap-1 disabled:opacity-40">
            <CropIcon size={14} /> Apply crop
          </button>
        </div>
      </div>
    )
  }

  // ── Adjust (sliders) view ─────────────────────────────────────────────────
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-60 mb-1">Original</p>
          <div className="aspect-square bg-ivory-dark border border-warm-grey rounded-none flex items-center justify-center overflow-hidden">
            <img src={src} alt="" className="w-full h-full object-contain" />
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-60 mb-1">Adjusted{base && ' · cropped'}</p>
          <div className="aspect-square bg-ivory-dark border border-warm-grey rounded-none flex items-center justify-center overflow-hidden">
            {error ? <span className="text-xs text-red-500 px-3 text-center">{error}</span>
              : !img ? <span className="text-xs text-ink-60">Loading…</span>
              : <canvas ref={canvasRef} className="w-full h-full object-contain" />}
          </div>
        </div>
      </div>

      {/* Crop & rotate launcher */}
      <div className="mt-3">
        <button type="button" onClick={openCrop} disabled={disabled || !img}
          className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
          <CropIcon size={14} /> Crop &amp; rotate
        </button>
        {base && (
          <button type="button" onClick={() => setBase(null)} disabled={disabled}
            className="ml-2 text-xs text-ink-60 hover:text-ink">Undo crop</button>
        )}
      </div>

      <div className="mt-4 space-y-2.5">
        {sliders.map(({ key, label, min, max, mid }) => (
          <div key={key} className="flex items-center gap-3">
            <label className="w-20 text-xs font-medium text-ink-60 shrink-0">{label}</label>
            <input
              type="range" min={min} max={max} value={s[key]} onChange={set(key)}
              disabled={disabled || !img}
              className="flex-1 accent-brand-600"
            />
            <span className={`w-10 text-right text-xs tabular-nums ${s[key] === mid ? 'text-ink-60' : 'text-ink-80 font-medium'}`}>
              {key === 'warmth' && s[key] > 0 ? `+${s[key]}` : s[key]}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setS(NEUTRAL)}
          disabled={disabled || isNeutral(s)}
          className="inline-flex items-center gap-1.5 text-xs text-ink-60 hover:text-ink disabled:opacity-40"
        >
          <RotateCcw size={13} /> Reset
        </button>
        <p className="text-[11px] text-ink-60">Instant, no AI — exact and repeatable. The original isn’t changed until you Keep.</p>
      </div>
    </div>
  )
}
