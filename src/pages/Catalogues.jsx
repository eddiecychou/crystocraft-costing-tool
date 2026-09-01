import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import { BookOpen, X } from 'lucide-react'

const STATUS_STYLES = {
  draft:     'badge bg-ivory-dark text-ink-70',
  published: 'badge bg-green-100 text-green-700',
}

export default function Catalogues({ embedded = false }) {
  const [catalogues, setCatalogues] = useState([])
  const [loading, setLoading]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    getDocs(query(collection(db, 'catalogues'), orderBy('createdAt', 'desc')))
      .then(snap => setCatalogues(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(err => console.error('Catalogues load error:', err))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id) {
    await deleteDoc(doc(db, 'catalogues', id))
    setCatalogues(c => c.filter(x => x.id !== id))
    setConfirmDelete(null)
  }

  if (loading) return <div className="p-4 md:p-6 max-w-4xl"><p className="eyebrow text-ink-40 py-10 text-center">Loading…</p></div>

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          {!embedded && <h1 className="text-2xl text-ink">Catalogues</h1>}
          <p className="text-sm text-ink-60 mt-1">Seasonal product collections for customers</p>
        </div>
        <Link to="/catalogues/new" className="btn-primary shrink-0">+ New Catalogue</Link>
      </div>

      {catalogues.length === 0 ? (
        <div className="card p-10 text-center">
          <BookOpen size={32} strokeWidth={1.25} className="mx-auto mb-3 text-platinum" />
          <p className="eyebrow text-ink-40 mb-1.5">Nothing yet</p>
          <p className="text-sm text-ink-60">Create your first customer-facing catalogue.</p>
          <Link to="/catalogues/new" className="text-brand-600 text-sm mt-3 inline-block">+ New Catalogue</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {catalogues.map(cat => (
            <div key={cat.id} className="card p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-ink truncate">{cat.name}</p>
                  <span className={STATUS_STYLES[cat.status] || STATUS_STYLES.draft}>
                    {cat.status || 'draft'}
                  </span>
                </div>
                {cat.season && <p className="text-xs text-ink-60 mt-1">{cat.season}</p>}
                {cat.tagline && <p className="text-xs text-ink-60 mt-1 truncate">{cat.tagline}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link to={`/catalogues/${cat.id}/preview`} className="btn-secondary text-xs px-3 py-1.5">Preview</Link>
                <Link to={`/catalogues/${cat.id}`} className="btn-secondary text-xs px-3 py-1.5">Edit</Link>
                <button
                  onClick={() => setConfirmDelete(cat)}
                  aria-label={`Delete ${cat.name}`}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-none text-ink-60 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                ><X size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Catalogue"
          message={`Delete "${confirmDelete.name}"? This cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
