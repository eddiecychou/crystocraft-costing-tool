import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { ChevronLeft } from 'lucide-react'
import CustomerBrandGallery from '../components/CustomerBrandGallery'
import ProposalEditor from '../components/ProposalEditor'

// Per-customer "Brand & Proposal" page. Split off Customer Detail (2026-09-04):
// the Brand Gallery + Proposal editors are ~1,200 lines of curation UI for a
// job done far less often than the CRM / quote / order work that fills that
// page. Customer Detail now shows a summary card (BrandProposalCard) that
// links here. Both child components take only `customerId` and manage their
// own Firestore reads.
export default function CustomerBrand() {
  const { id } = useParams()
  const [customer, setCustomer] = useState(null)

  useEffect(() => {
    if (!id) return
    return onSnapshot(doc(db, 'customers', id), s =>
      setCustomer(s.exists() ? { id: s.id, ...s.data() } : null))
  }, [id])

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <Link to={`/customers/${id}`}
        className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
        <ChevronLeft size={15} /> {customer?.company_name || 'Customer'}
      </Link>

      <h1 className="text-xl md:text-2xl text-ink mt-2 mb-1">Brand &amp; Proposal</h1>
      <p className="text-sm text-ink-60 mb-6">
        Brand assets and the customer-facing proposal for{' '}
        <span className="text-ink-80">{customer?.company_name || 'this customer'}</span>.
      </p>

      <div className="space-y-6">
        <CustomerBrandGallery customerId={id} />
        <ProposalEditor customerId={id} customerName={customer?.company_name} />
      </div>
    </div>
  )
}
