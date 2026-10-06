import { useEffect, useState } from 'react'
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { getDownloadURL, ref, uploadString } from 'firebase/storage'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { db, storage, authedUser } from '../firebase'
import { captureIdFromSearch, extensionIdFromSearch, normaliseSourcingCapture, requestExtensionCapture } from '../sourcingCapture'

export default function SourcingCaptureImport() {
  const location = useLocation(); const navigate = useNavigate()
  const [capture, setCapture] = useState(null); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const captureId = captureIdFromSearch(location.search); const extensionId = extensionIdFromSearch(location.search)
  useEffect(() => {
    if (!captureId || !extensionId) { setError('This import link is incomplete. Return to the 1688 listing and use Capture to OC again.'); return }
    requestExtensionCapture(extensionId, captureId).then(raw => setCapture(normaliseSourcingCapture(raw))).catch(err => setError(err.message || 'The capture could not be opened.'))
  }, [captureId, extensionId])
  async function save() {
    if (!capture || saving) return
    setSaving(true); setError('')
    try {
      const user = await authedUser(); if (!user) throw new Error('Please sign in to the Operation Center first.')
      let screenshot = {}
      if (capture.screenshot_data_url) {
        const path = `sourcing-captures/${user.uid}/${captureId}/visible-page.jpg`; const file = ref(storage, path)
        await uploadString(file, capture.screenshot_data_url, 'data_url', { contentType: 'image/jpeg' })
        screenshot = { screenshot_storage_path: path, screenshot_url: await getDownloadURL(file) }
      }
      const captureRef = doc(db, 'sourcing_captures', captureId)
      // The image binary has already gone to Storage. Never duplicate a data
      // URL into Firestore: it is both the wrong store and can exceed its 1 MiB
      // document limit.
      const { screenshot_data_url: _screenshotDataUrl, ...record } = capture
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(captureRef)
        if (existing.exists() && existing.data().captured_by_uid !== user.uid) throw new Error('This capture identifier is already in use.')
        if (!existing.exists()) transaction.set(captureRef, { ...record, ...screenshot, captured_by_uid: user.uid, status: 'needs_review', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      })
      navigate(`/sourcing-captures/${captureId}`, { replace: true })
    } catch (err) { setError(err.message || 'Could not save this capture.') }
    finally { setSaving(false) }
  }
  if (error) return <div className="p-6 max-w-2xl"><div className="card p-6"><p className="eyebrow mb-2">1688 Capture</p><h1 className="text-2xl mb-3">Capture not ready</h1><p className="text-sm text-ink-70">{error}</p><Link className="btn-secondary inline-flex mt-5" to="/sourcing-captures">Open capture inbox</Link></div></div>
  if (!capture) return <div className="p-6 text-ink-60">Opening 1688 capture…</div>
  const { source, evidence } = capture
  return <div className="p-4 md:p-6 max-w-3xl"><div className="mb-6"><p className="eyebrow mb-1">1688 Capture</p><h1 className="text-2xl">Review before saving</h1><p className="text-sm text-ink-60 mt-1">This creates an internal sourcing record only — not a supplier, product, quotation or customer-facing listing.</p></div><div className="card p-5 space-y-5"><section><p className="label mb-1">Listing</p><p className="text-sm text-ink">{evidence.page_title || 'Untitled 1688 listing'}</p><a className="text-sm text-brand-600 hover:underline break-all" href={source.url} target="_blank" rel="noreferrer">Open original 1688 page</a></section><div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><section><p className="label mb-1">Offer ID</p><p className="text-sm">{source.offer_id || 'Not detected'}</p></section><section><p className="label mb-1">Visible supplier name</p><p className="text-sm">{evidence.supplier_name_visible || 'Not detected — confirm before creating supplier'}</p></section></div><section><p className="label mb-1">Selected option shown on page</p><p className="text-sm whitespace-pre-wrap">{evidence.selected_options_visible || 'Not detected — confirm the SKU in the original listing.'}</p></section><section><p className="label mb-1">Evidence included</p><p className="text-sm text-ink-70">{evidence.image_urls.length} source image URL{evidence.image_urls.length === 1 ? '' : 's'}{capture.screenshot_data_url ? ' and one visible-page screenshot.' : '.'}</p></section><div className="flex flex-wrap gap-3 pt-1"><button className="btn-primary" type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save to capture inbox'}</button><Link className="btn-secondary" to="/sourcing-captures">Cancel</Link></div></div></div>
}
