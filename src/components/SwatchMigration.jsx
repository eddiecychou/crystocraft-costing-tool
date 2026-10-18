import { useState } from 'react'
import JSZip from 'jszip'
import { prepareSwatchImport } from '../domain/crystalSwatches'
import { applySwatchImport } from '../crystalSwatches'

export default function SwatchMigration({onDone,onClose}) {
  const [prepared,setPrepared]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reviewed,setReviewed]=useState(false),[progress,setProgress]=useState(null),[complete,setComplete]=useState(false)
  async function inspect(file) {
    if(!file)return
    setBusy(true);setError('');setPrepared(null);setReviewed(false);setComplete(false)
    try {
      if(file.size>150*1024*1024)throw Error('Backup ZIP must be at most 150 MB.')
      setPrepared(await prepareSwatchImport(await JSZip.loadAsync(file,{checkCRC32:true})))
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function apply() {
    setBusy(true);setError('')
    try{await applySwatchImport(prepared,setProgress);setComplete(true);await onDone()}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="card p-4 mb-4" aria-labelledby="migration-title">
    <div className="flex flex-wrap justify-between items-center gap-2 mb-2"><h2 id="migration-title" className="text-lg">Import verified swatch backup</h2><button className="btn-ghost min-h-11" disabled={busy} onClick={onClose}>Close import</button></div>
    <p className="text-sm text-ink-60 mb-3">Review a prepared backup ZIP. Checking the file does not change the library. Originals, templates and extra files remain in your private backup.</p>
    <input aria-label="Verified migration ZIP" type="file" accept=".zip" className="input mb-3" disabled={busy} onChange={e=>inspect(e.target.files?.[0])}/>
    {busy && !progress && <p role="status" className="text-sm">Checking all backup files and photo checksums…</p>}
    {prepared && <div className="space-y-3">
      <p className="text-sm">{prepared.colourCount} colours · {prepared.samples.length} registered photos · {prepared.extraFiles.length} extra files kept private</p>
      <details><summary className="text-sm cursor-pointer min-h-11">Review sample mapping</summary><div className="max-h-56 overflow-auto mt-2"><table className="w-full text-xs"><thead><tr><th className="text-left">Colour</th><th className="text-left">Material</th><th className="text-left">Backing</th></tr></thead><tbody>{prepared.samples.map(s=><tr key={s.id}><td className="py-1 break-words">{s.color_name}</td><td>{s.style}</td><td>{s.backing_label}</td></tr>)}</tbody></table></div></details>
      <p className="text-xs text-ink-60 break-all">Manifest: {prepared.manifestHash}</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy||complete} checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>I reviewed this backup and mapping. Import the registered samples for the existing approved-customer audience.</span></label>
      {!complete && <button className="btn-primary min-h-11" disabled={!reviewed||busy} onClick={apply}>{busy?'Importing and verifying…':progress?'Resume reviewed import':'Import reviewed samples'}</button>}
    </div>}
    {progress && <div className="mt-3 text-sm" role="status"><progress className="w-full" max={progress.total} value={progress.done}/><p>{progress.done} / {progress.total} verified · {progress.label}</p></div>}
    {complete && <p role="status" className="mt-3 text-sm">Import verified. The swatch pages now use the Firebase copy.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-brand-700 break-words">{error} Your reviewed file is retained; resolve the issue and resume.</p>}
  </section>
}
