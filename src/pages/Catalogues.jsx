import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'

const STATUS_STYLES = {
  draft:     'bg-gray-100 text-gray-600',
  published: 'bg-green-100 text-green-700',
}

export default function Catalogues() {
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

  if (loading) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catalogues</h1>
          <p className="text-sm text-gray-500 mt-0.5">Seasonal product collections for customers</p>
        </div>
        <Link to="/catalogues/new" className="btn-primary">+ New Catalogue</Link>
      </div>

      {catalogues.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-3xl mb-3">📖</p>
          <p className="text-gray-500 text-sm">No catalogues yet. Create your first one.</p>
          <Link to="/catalogues/new" className="btn-primary mt-4 inline-block">+ New Catalogue</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {catalogues.map(cat => (
            <div key={cat.id} className="card p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-900 truncate">{cat.name}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[cat.status] || STATUS_STYLES.draft}`}>
                    {cat.status || 'draft'}
                  </span>
                </div>
                {cat.season && <p className="text-xs text-gray-400 mt-0.5">{cat.season}</p>}
                {cat.tagline && <p className="text-sm text-gray-500 mt-1 truncate">{cat.tagline}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link to={`/catalogues/${cat.id}/preview`} className="btn-secondary text-xs px-3 py-1.5">Preview</Link>
                <Link to={`/catalogues/${cat.id}`} className="btn-primary text-xs px-3 py-1.5">Edit</Link>
                <button
                  onClick={() => setConfirmDelete(cat)}
                  className="text-xs text-gray-400 hover:text-red-500 px-2 py-1.5"
                >✕</button>
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
