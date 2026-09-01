import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useComponents } from '../criticalComponents'
import { Puzzle, Package, X } from 'lucide-react'

// Load every corp-gift component (products/{p}/components/{c}). Follows the
// codebase convention of fanning out over products instead of a collectionGroup
// query (avoids the extra index + rule). Lazy — only runs when the picker opens.
async function loadCorpComponents() {
  const prodSnap = await getDocs(collection(db, 'products'))
  const out = []
  await Promise.all(prodSnap.docs.map(async p => {
    const pName = p.data()?.name || '(unnamed product)'
    const compSnap = await getDocs(collection(db, 'products', p.id, 'components'))
    compSnap.docs.forEach(c => {
      out.push({
        type: 'corp',
        product_id: p.id,
        component_id: c.id,
        component_name: c.data()?.name || '(unnamed component)',
        product_name: pName,
      })
    })
  }))
  return out
}

export default function ComponentLinkPicker({ onPick, onClose }) {
  const { components: rangeComps } = useComponents()
  const [corp, setCorp] = useState(null)   // null = loading
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('corp')   // corp | range

  useEffect(() => { loadCorpComponents().then(setCorp).catch(() => setCorp([])) }, [])

  const corpFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = corp || []
    if (!q) return list
    return list.filter(c => [c.component_name, c.product_name].some(v => (v || '').toLowerCase().includes(q)))
  }, [corp, search])

  const rangeFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rangeComps
    return rangeComps.filter(c => [c.code, c.name, c.category].some(v => (v || '').toLowerCase().includes(q)))
  }, [rangeComps, search])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-none shadow-lg w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-grey">
          <h2 className="text-base">Link to a component</h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70"><X size={18} /></button>
        </div>

        <div className="px-5 pt-3">
          <input autoFocus type="text" className="input w-full text-sm" placeholder="Search component or product…"
                 value={search} onChange={e => setSearch(e.target.value)} />
          <div className="flex gap-1 mt-3 border-b border-warm-grey">
            {[['corp', 'Corp Gift'], ['range', 'Figurine']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-60 hover:text-ink-80'}`}>
                {label} {k === 'corp' ? (corp ? `(${corpFiltered.length})` : '…') : `(${rangeFiltered.length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto px-2 py-2 flex-1">
          {tab === 'corp' ? (
            corp == null ? <p className="text-sm text-ink-60 text-center py-8">Loading components…</p>
            : corpFiltered.length === 0 ? <p className="text-sm text-ink-60 text-center py-8">No matching components.</p>
            : corpFiltered.map(c => (
              <button key={`${c.product_id}:${c.component_id}`} onClick={() => onPick({ type: 'corp', product_id: c.product_id, component_id: c.component_id, label: c.component_name })}
                      className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-none hover:bg-ivory">
                <Package size={15} className="text-platinum shrink-0 mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm text-ink truncate">{c.component_name}</span>
                  <span className="block text-xs text-ink-60 truncate">{c.product_name}</span>
                </span>
              </button>
            ))
          ) : (
            rangeFiltered.length === 0 ? <p className="text-sm text-ink-60 text-center py-8">No matching components.</p>
            : rangeFiltered.slice(0, 300).map(c => (
              <button key={c.id} onClick={() => onPick({ type: 'range', component_id: c.id, label: c.code || c.name })}
                      className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-none hover:bg-ivory">
                <Puzzle size={15} className="text-platinum shrink-0 mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-mono text-ink truncate">{c.code}</span>
                  <span className="block text-xs text-ink-60 truncate">{c.name}{c.category ? ` · ${c.category}` : ''}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
