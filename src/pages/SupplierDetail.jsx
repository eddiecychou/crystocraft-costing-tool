import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import SupplierCatalogs from '../components/SupplierCatalogs'
import { SUPPLIER_CATEGORIES } from '../constants'

function toArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean)
  if (val && typeof val === 'string') return [val]
  return []
}

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 break-all">{value}</span>
    </div>
  )
}

function MultiRow({ label, values, render }) {
  const arr = toArray(values)
  if (!arr.length) return null
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
      <div className="space-y-0.5">
        {arr.map((v, i) => <div key={i} className="text-sm text-gray-800 break-all">{render ? render(v) : v}</div>)}
      </div>
    </div>
  )
}

export default function SupplierDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [supplier, setSupplier]         = useState(null)
  const [loading, setLoading]           = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'suppliers', id)).then(snap => {
      if (snap.exists()) setSupplier({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
  }, [id])

  async function handleDelete() {
    await deleteDoc(doc(db, 'suppliers', id))
    navigate('/suppliers')
  }

  if (loading) return <LoadingBar />
  if (!supplier) return <div className="p-6 text-gray-500">Supplier not found.</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/suppliers" className="text-sm text-brand-600 hover:underline">← Suppliers</Link>

      <div className="flex items-start justify-between mt-2 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{supplier.name}</h1>
            {supplier.erp_code && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">{supplier.erp_code}</span>
            )}
          </div>
          {supplier.name_cn && <p className="text-gray-500 text-sm mt-0.5">{supplier.name_cn}</p>}
          {supplier.category && (() => {
            const cat = SUPPLIER_CATEGORIES.find(c => c.value === supplier.category)
            return cat ? (
              <span className="inline-block mt-1.5 text-xs px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 font-medium">
                {cat.emoji} {supplier.category}
              </span>
            ) : null
          })()}
        </div>
        <div className="flex gap-2">
          <Link to={`/suppliers/${id}/edit`} className="btn-secondary">Edit</Link>
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </div>

      <div className="card p-5 space-y-0">
        <InfoRow label="Contact Person" value={supplier.contact_person} />
        <InfoRow label="Country" value={supplier.country} />
        <InfoRow label="City / Region" value={supplier.city} />
        <InfoRow label="Address" value={supplier.address} />
        <MultiRow label="Phone" values={supplier.phones ?? supplier.phone}
          render={v => <a href={`tel:${v}`} className="text-brand-600 hover:underline">{v}</a>} />
        <InfoRow label="WeChat ID" value={supplier.wechat_id} />
        <InfoRow label="WhatsApp" value={supplier.whatsapp} />
        <MultiRow label="Email" values={supplier.emails ?? supplier.email}
          render={v => <a href={`mailto:${v}`} className="text-brand-600 hover:underline">{v}</a>} />
        {supplier.notes && (
          <div className="pt-3 mt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{supplier.notes}</p>
          </div>
        )}
      </div>

      <SupplierCatalogs supplierId={id} />

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${supplier.name}"? This will not affect existing quotes that reference this supplier.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
