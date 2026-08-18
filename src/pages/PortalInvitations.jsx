import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Mail, Clock, CheckCircle2, XCircle, Ban, RefreshCw, Loader2, UserPlus } from 'lucide-react'
import { resendInvitation, revokeInvitation, rejectInvitation, approveInvitation } from '../portalInviteApi'
import { CustomerPicker } from './CustomerAccounts'

// SU-07A — admin view of portal_invitations (see netlify/functions/
// portal-invite.js for the full lifecycle). Read directly via the client
// SDK (firestore.rules: admin-only) same as CustomerAccounts.jsx reads
// users/ — every WRITE here goes through the Node function instead, since
// approve/resend/revoke/reject all need the Firebase Admin SDK.
function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_STYLE = {
  pending:  { label: 'Pending',  Icon: Clock,       cls: 'text-amber-600 bg-amber-50' },
  claimed:  { label: 'Claimed — awaiting approval', Icon: Mail, cls: 'text-blue-600 bg-blue-50' },
  approved: { label: 'Approved', Icon: CheckCircle2, cls: 'text-green-600 bg-green-50' },
  rejected: { label: 'Rejected', Icon: XCircle,     cls: 'text-red-600 bg-red-50' },
  revoked:  { label: 'Revoked',  Icon: Ban,         cls: 'text-gray-500 bg-gray-100' },
  expired:  { label: 'Expired',  Icon: Clock,       cls: 'text-gray-500 bg-gray-100' },
}

// source:'admin' vs 'self' — see portal-invite.js's createInvitation/
// applyForAccount. Shown so an admin never confuses a self-submitted
// application (needs a customer link before it can be approved) with one
// they already invited and pointed at a known customer.
const SOURCE_STYLE = {
  admin: { label: 'Invited', cls: 'text-purple-600 bg-purple-50' },
  self:  { label: 'Applied', cls: 'text-teal-600 bg-teal-50' },
}

export default function PortalInvitations({ embedded = false }) {
  const [invitations, setInvitations] = useState([])
  const [customers, setCustomers] = useState([])
  const [customersById, setCustomersById] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [pickCustomerFor, setPickCustomerFor] = useState({}) // invitationId -> selected customerId

  useEffect(() => {
    return onSnapshot(collection(db, 'portal_invitations'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setInvitations(all)
      setLoading(false)
    })
  }, [])
  useEffect(() => {
    return onSnapshot(collection(db, 'customers'), snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setCustomers(rows)
      setCustomersById(Object.fromEntries(rows.map(c => [c.id, c])))
    })
  }, [])

  async function run(fn, id) {
    setBusyId(id); setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message || 'Action failed.')
    } finally {
      setBusyId(null)
    }
  }

  const content = (
    <div className={embedded ? '' : 'p-4 md:p-6'}>
      {!embedded && <h1 className="text-xl md:text-2xl mb-4">Portal Invitations</h1>}
      {error && (
        <div className="mb-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>
      )}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : invitations.length === 0 ? (
        <p className="text-sm text-gray-400">No invitations yet. Invite a customer contact from their record in Customers, or wait for a self-submitted request.</p>
      ) : (
        <div className="card divide-y divide-gray-100">
          {invitations.map(inv => {
            const st = STATUS_STYLE[inv.status] || STATUS_STYLE.pending
            const srcStyle = SOURCE_STYLE[inv.source] || SOURCE_STYLE.admin
            const company = inv.customer_id ? (customersById[inv.customer_id]?.company_name || inv.customer_id) : null
            const busy = busyId === inv.id
            const needsCustomerLink = inv.status === 'claimed' && !inv.customer_id
            const pickedCustomerId = pickCustomerFor[inv.id] || ''
            return (
              <div key={inv.id} className="px-4 py-3 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                    {inv.contact_name || inv.contact_email}
                    <span className={`text-[10px] uppercase tracking-wide rounded px-1 py-0.5 ${srcStyle.cls}`}>{srcStyle.label}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {inv.contact_email} · {company || (inv.source === 'self'
                      ? `Applicant typed "${inv.applicant_company_name || '—'}" — no customer linked yet`
                      : '—')}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {inv.source === 'self' ? 'Applied' : 'Invited'} {fmtDate(inv.created_at)}{inv.source === 'admin' && ` by ${inv.created_by || '—'}`}
                    {inv.claimed_at && inv.source === 'admin' && ` · Claimed ${fmtDate(inv.claimed_at)}`}
                    {inv.approved_at && ` · Approved ${fmtDate(inv.approved_at)}`}
                    {inv.email_send_status === 'failed' && (
                      <span className="text-red-600"> · Last email failed to send</span>
                    )}
                  </p>
                  {needsCustomerLink && (
                    <div className="mt-2 max-w-xs">
                      <label className="text-[11px] text-gray-500 mb-1 flex items-center gap-1"><UserPlus size={11} /> Link to a customer before approving</label>
                      <CustomerPicker
                        customers={customers}
                        value={pickedCustomerId}
                        onChange={cid => setPickCustomerFor(prev => ({ ...prev, [inv.id]: cid }))}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex items-center gap-1 text-xs rounded px-2 py-1 ${st.cls}`}>
                    <st.Icon size={12} /> {st.label}
                  </span>
                  {busy ? (
                    <Loader2 size={16} className="animate-spin text-gray-400" />
                  ) : (
                    <>
                      {inv.status === 'claimed' && (
                        <>
                          <button
                            onClick={() => run(() => approveInvitation(inv.id, pickedCustomerId || undefined), inv.id)}
                            disabled={needsCustomerLink && !pickedCustomerId}
                            className="btn-primary text-xs py-1 px-2 disabled:opacity-40"
                          >
                            Approve
                          </button>
                          <button onClick={() => run(() => rejectInvitation(inv.id), inv.id)} className="btn-secondary text-xs py-1 px-2">Reject</button>
                        </>
                      )}
                      {inv.status === 'pending' && (
                        <>
                          <button onClick={() => run(() => resendInvitation(inv.id), inv.id)} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1">
                            <RefreshCw size={11} /> Resend
                          </button>
                          <button onClick={() => run(() => revokeInvitation(inv.id), inv.id)} className="btn-secondary text-xs py-1 px-2 text-red-600">Revoke</button>
                        </>
                      )}
                      {inv.status === 'approved' && inv.email_send_status === 'failed' && (
                        <button onClick={() => run(() => resendInvitation(inv.id), inv.id)} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1">
                          <RefreshCw size={11} /> Resend setup email
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return content
}
