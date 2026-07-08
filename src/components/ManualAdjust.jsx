import { useState, useEffect, useRef, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'

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
  const [s, setS]       = useState(NEUTRAL)
  const [bitmap, setBitmap] = useState(null)
  const [error, setError]   = useState('')
  const canvasRef = useRef(null)
  const rafRef    = useRef(0)

  // Load the source once, via blob → bitmap (same-origin, avoids canvas taint
  // so toDataURL works even for cross-origin Storage URLs).
  useEffect(() => {
    let cancelled = false
    setError(''); setBitmap(null)
    ;(async () => {
      try {
        const blob = await (await fetch(src)).blob()
        const bmp  = await createImageBitmap(blob)
        if (!cancelled) setBitmap(bmp)
      } catch {
        if (!cancelled) setError('Could not load image for editing.')
      }
    })()
    return () => { cancelled = true }
  }, [src])

  // Render pipeline: filters (brightness/contrast/saturation) via ctx.filter,
  // then warmth + sharpen as pixel passes. Throttled to one frame.
  const render = useCallback(() => {
    const bmp = bitmap, canvas = canvasRef.current
    if (!bmp || !canvas) return
    const max = 1400
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.filter = `brightness(${s.brightness}%) contrast(${s.contrast}%) saturate(${s.saturation}%)`
    ctx.drawImage(bmp, 0, 0, w, h)
    ctx.filter = 'none'
    if (s.warmth || s.sharpness) {
      const imgData = ctx.getImageData(0, 0, w, h)
      applyWarmth(imgData.data, s.warmth)
      applySharpen(imgData.data, s.sharpness, w, h)
      ctx.putImageData(imgData, 0, 0)
    }
    onResult?.(canvas.toDataURL('image/jpeg', 0.92))
  }, [bitmap, s, onResult])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafRef.current)
  }, [render])

  const set = (key) => (e) => setS(prev => ({ ...prev, [key]: Number(e.target.value) }))

  const sliders = [
    { key: 'brightness', label: 'Brightness', min: 50,   max: 150, mid: 100 },
    { key: 'contrast',   label: 'Contrast',   min: 50,   max: 150, mid: 100 },
    { key: 'saturation', label: 'Saturation', min: 0,    max: 200, mid: 100 },
    { key: 'warmth',     label: 'Warmth',     min: -100, max: 100, mid: 0   },
    { key: 'sharpness',  label: 'Sharpness',  min: 0,    max: 100, mid: 0   },
  ]

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Original</p>
          <div className="aspect-square bg-gray-100 border border-gray-200 rounded flex items-center justify-center overflow-hidden">
            <img src={src} alt="" className="w-full h-full object-contain" />
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Adjusted</p>
          <div className="aspect-square bg-gray-100 border border-gray-200 rounded flex items-center justify-center overflow-hidden">
            {error ? <span className="text-xs text-red-500 px-3 text-center">{error}</span>
              : !bitmap ? <span className="text-xs text-gray-400">Loading…</span>
              : <canvas ref={canvasRef} className="w-full h-full object-contain" />}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {sliders.map(({ key, label, min, max, mid }) => (
          <div key={key} className="flex items-center gap-3">
            <label className="w-20 text-xs font-medium text-gray-500 shrink-0">{label}</label>
            <input
              type="range" min={min} max={max} value={s[key]} onChange={set(key)}
              disabled={disabled || !bitmap}
              className="flex-1 accent-brand-600"
            />
            <span className={`w-10 text-right text-xs tabular-nums ${s[key] === mid ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>
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
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
        >
          <RotateCcw size={13} /> Reset
        </button>
        <p className="text-[11px] text-gray-400">Instant, no AI — exact and repeatable. The original isn’t changed until you Keep.</p>
      </div>
    </div>
  )
}
