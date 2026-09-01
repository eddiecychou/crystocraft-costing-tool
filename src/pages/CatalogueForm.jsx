import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, getDoc, addDoc, updateDoc, collection, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { Camera } from 'lucide-react'

export default function CatalogueForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const fileRef = useRef()

  const [form, setForm] = useState({
    name: '', season: '', tagline: '', status: 'draft',
    cover_image: '', overlay_color: 'black', overlay_opacity: 0.45,
  })
  const [loading, setLoading]     = useState(false)
  const [fetching, setFetching]   = useState(isEdit)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'catalogues', id)).then(snap => {
      if (snap.exists()) setForm(f => ({ ...f, ...snap.data() }))
      setFetching(false)
    })
  }, [id, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }
  function setVal(field, val) { setForm(f => ({ ...f, [field]: val })) }

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const path = `catalogues/${id || 'new'}/cover_${Date.now()}`
      const sRef = storageRef(storage, path)
      await uploadBytes(sRef, file, { contentType: file.type })
      const url = await getDownloadURL(sRef)
      setVal('cover_image', url)
      if (isEdit) await updateDoc(doc(db, 'catalogues', id), { cover_image: url })
    } catch (err) {
      console.error('[CoverUpload] error:', err)
      alert(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'catalogues', id), { ...form, updatedAt: serverTimestamp() })
        navigate(`/catalogues/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'catalogues'), {
          ...form, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        navigate(`/catalogues/${ref.id}`)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <div className="mb-6">
        <Link to="/catalogues" className="text-sm text-brand-600 hover:underline">← Catalogues</Link>
        <h1 className="text-2xl font-bold text-ink mt-1">{isEdit ? 'Edit Catalogue' : 'New Catalogue'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Basic info */}
        <div className="card p-6 space-y-5">
          <div>
            <label className="label">Catalogue Name *</label>
            <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Q3 2026 Collection" />
          </div>
          <div>
            <label className="label">Season / Period</label>
            <input className="input" value={form.season} onChange={set('season')} placeholder="e.g. Autumn / Winter 2026" />
          </div>
          <div>
            <label className="label">Tagline</label>
            <input className="input" value={form.tagline} onChange={set('tagline')} placeholder="e.g. Crafted for every moment" />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={set('status')}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>

        {/* Cover page design */}
        <div className="card p-6 space-y-5">
          <h2 className="font-semibold text-ink text-sm">Cover Page Design</h2>

          {/* Background image upload — single hidden input, triggered by button/label */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleCoverUpload}
            disabled={uploading}
          />
          <div>
            <label className="label">Background Image</label>
            {form.cover_image ? (
              <div className="relative rounded-lg overflow-hidden" style={{ height: 140 }}>
                <img src={form.cover_image} alt="" className="w-full h-full object-cover" />
                <div
                  className="absolute inset-0"
                  style={{
                    background: form.overlay_color === 'white' ? 'white' : 'black',
                    opacity: form.overlay_opacity,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-white text-xs font-medium drop-shadow">Preview</p>
                </div>
                <button
                  type="button"
                  onClick={() => fileRef.current.click()}
                  className="absolute top-2 right-2 bg-white/90 text-xs px-2 py-1 rounded text-ink-80 hover:bg-white"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => setVal('cover_image', '')}
                  className="absolute top-2 left-2 bg-white/90 text-xs px-2 py-1 rounded text-red-500 hover:bg-white"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-warm-grey rounded-lg p-6 hover:border-brand-300 hover:bg-brand-50 transition-colors text-ink-60 text-sm"
              >
                {uploading ? 'Uploading…' : <span className="inline-flex items-center gap-1.5"><Camera size={15} />Click to upload cover image</span>}
              </button>
            )}
          </div>

          {/* Overlay colour */}
          <div>
            <label className="label">Overlay Colour</label>
            <div className="flex gap-3">
              {['black', 'white'].map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setVal('overlay_color', color)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm capitalize transition-all ${
                    form.overlay_color === color
                      ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
                      : 'border-warm-grey text-ink-60 hover:border-warm-grey'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-full border border-warm-grey inline-block"
                    style={{ background: color }}
                  />
                  {color}
                </button>
              ))}
            </div>
          </div>

          {/* Overlay opacity */}
          <div>
            <label className="label">
              Overlay Opacity — <span className="text-brand-600 font-semibold">{Math.round(form.overlay_opacity * 100)}%</span>
            </label>
            <input
              type="range" min="0" max="0.9" step="0.05"
              value={form.overlay_opacity}
              onChange={e => setVal('overlay_opacity', parseFloat(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="flex justify-between text-xs text-ink-60 mt-0.5">
              <span>0% (fully transparent)</span>
              <span>90% (nearly opaque)</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Catalogue'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
