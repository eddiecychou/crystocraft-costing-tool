// Always shown (not just for contacts) so it's obvious at a glance which
// pool a draft came from — customers/ (real account, richer context) vs
// marketing_contacts/ (a trade lead, thinner context — see contactToEntity).
export default function SourceBadge({ source }) {
  const isContact = source === 'contact'
  return (
    <span className={`ml-1.5 text-2xs uppercase tracking-wide rounded-none px-1 py-0.5 shrink-0 ${
 isContact ? 'text-amber-600 bg-amber-50' : 'text-blue-600 bg-blue-50'
    }`}>
      {isContact ? 'Lead' : 'Customer'}
    </span>
  )
}
