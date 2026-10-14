import { useState } from 'react'
import { useRole } from '../access'
import { previewCatalogueImageRepairs, applyCatalogueImageRepairs } from '../catalogueImageMaintenance'

export default function CatalogueImageMaintenance() {
  const role = useRole()
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  if (role !== 'admin') return null
  async function preview() {
    setBusy(true); setError(''); setResult(null); setPlan(null)
    try { setPlan(await previewCatalogueImageRepairs(setProgress)) }
    catch (e) { setError(e.message) }
    finally { setBusy(false); setProgress(null) }
  }
  async function apply() {
    setBusy(true); setError('')
    try { setResult(await applyCatalogueImageRepairs(plan, setProgress)); setPlan(null) }
    catch (e) { setError(e.message) }
    finally { setBusy(false); setProgress(null) }
  }
  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <h2 className="text-lg mb-2">Catalogue Images</h2>
      <p className="text-sm text-ink-60 mb-4">Check main images and make saved catalogue photos faster to load. Preview the repairs before applying them.</p>
      <button type="button" className="btn-secondary min-h-[44px]" onClick={preview} disabled={busy}>Preview repairs</button>
      {progress && <p role="status" className="text-sm text-ink-60 mt-4">{progress.phase} · {progress.done} of {progress.total}</p>}
      {error && <p role="alert" className="text-sm text-red-700 mt-4">{error}</p>}
      {plan && (
        <div className="card p-4 md:p-6 mt-4 space-y-4">
          <p className="text-sm text-ink-60">Checked {plan.products} corporate products and {plan.ranges} Figurine designs. No changes have been applied.</p>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div><dt className="label">Main image repairs</dt><dd>{plan.heroChanges.length}</dd></div>
            <div><dt className="label">Image caching repairs</dt><dd>{plan.cacheChanges.length}</dd></div>
            <div><dt className="label">Unavailable photos skipped</dt><dd>{plan.skipped.length}</dd></div>
          </dl>
          {plan.heroChanges.length > 0 && <ul className="text-sm text-ink-70 space-y-2 break-words">{plan.heroChanges.slice(0,20).map(p => <li key={p.id}>{p.name} · {p.before.heroImage === p.after.heroImage ? 'Refresh image information' : 'Refresh main image'}</li>)}{plan.heroChanges.length > 20 && <li>And {plan.heroChanges.length - 20} more.</li>}</ul>}
          <p className="text-sm text-ink-60">Only main-image references and browser caching are updated. Photos retain their visibility and branding tags.</p>
          <button type="button" className="btn-primary min-h-[44px]" onClick={apply} disabled={busy || !(plan.heroChanges.length + plan.cacheChanges.length)}>Apply repairs</button>
        </div>
      )}
      {result && <div role="status" className="card p-4 md:p-6 mt-4 text-sm space-y-2"><p>Updated {result.heroes} main-image references and caching for {result.images} photos.</p><p>{result.skipped.length} changed photos skipped · {result.failed.length} updates failed.</p>{result.failed.map((f,i) => <p key={i} className="text-red-700 break-words">{f.name}: {f.reason}</p>)}<p className="text-ink-60">Run another preview to verify the catalogue or retry any failed updates.</p></div>}
    </div>
  )
}
