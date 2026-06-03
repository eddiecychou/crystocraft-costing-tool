import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')

  useEffect(() => {
    const q = query(collection(db, 'suppliers'), orderBy('name'))
    return onSnapshot(q, snap => {
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  const filtered = suppliers.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{suppliers.length} suppliers in database</p>
        </div>
        <Link to="/suppliers/new" className="btn-primary">+ New Supplier</Link>
      </div>

      <input
        type="text"
        placeholder="Search suppliers…"
        className="input max-w-xs mb-6"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          {suppliers.length === 0 ? 'No suppliers yet — add your first one.' : 'No suppliers match your search.'}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(s => (
            <Link
              key={s.id}
              to={`/suppliers/${s.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div>
                <p className="font-medium text-gray-900 text-sm">{s.name}</p>
                {s.name_cn && <p className="text-xs text-gray-500">{s.name_cn}</p>}
                <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                  {s.country && <span>📍 {s.country}</span>}
                  {s.phone && <span>📞 {s.phone}</span>}
                  {s.wechat_id && <span>💬 {s.wechat_id}</span>}
                </div>
              </div>
              <span className="text-xs text-gray-400">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
