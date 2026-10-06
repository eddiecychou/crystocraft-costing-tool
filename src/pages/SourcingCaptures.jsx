import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'

const formatDate = value => value?.toDate?.().toLocaleString() || 'Just captured'

export default function SourcingCaptures() {
  const { id } = useParams(); const [captures, setCaptures] = useState([]); const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(collection(db, 'sourcing_captures'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => { setCaptures(snap.docs.map(item => ({ id: item.id, ...item.data() }))); setLoading(false) }, () => setLoading(false))
  }, [])
  const selected = id ? captures.find(item => item.id === id) : null
  if (id && !loading && !selected) return <div className="p-6"><div className="card p-6"><h1 className="text-2xl mb-2">Capture not found</h1><Link className="btn-secondary inline-flex" to="/sourcing-captures">Back to capture inbox</Link></div></div>
  if (selected) return <CaptureDetail capture={selected} />
  return <CaptureList captures={captures} loading={loading} />
}
function CaptureList({ captures, loading }) {
  return <div className="p-4 md:p-6 max-w-6xl">{loading && <LoadingBar />}<div className="mb-6"><p className="eyebrow mb-1">Supply</p><h1 className="text-2xl">1688 Captures</h1><p className="text-sm text-ink-60 mt-1">Browser-captured source evidence awaiting review. These are not supplier quotes or catalogue products.</p></div>{!loading && captures.length === 0 ? <div className="card p-6"><p className="eyebrow mb-2">No captures yet</p><p className="text-sm text-ink-70">Open an 1688 product listing, choose the relevant option and click the Capture to OC Chrome button.</p></div> : <div className="space-y-3">{captures.map(capture => <Link key={capture.id} to={`/sourcing-captures/${capture.id}`} className="card block p-4 hover:bg-ivory-dark focus-visible:ring-2 focus-visible:ring-brand-600"><div className="flex gap-4"><div className="flex-1 min-w-0"><p className="text-sm text-ink break-words">{capture.evidence?.page_title || 'Untitled 1688 listing'}</p><p className="text-xs text-ink-60 mt-1">Offer {capture.source?.offer_id || 'not detected'} · {capture.evidence?.supplier_name_visible || 'supplier not detected'} · {formatDate(capture.createdAt)}</p></div><span className="badge shrink-0">Needs review</span></div></Link>)}</div>}</div>
}
function CaptureDetail({ capture }) {
  const { source = {}, evidence = {} } = capture
  return <div className="p-4 md:p-6 max-w-4xl"><div className="mb-6"><Link className="text-sm text-brand-600 hover:underline" to="/sourcing-captures">← 1688 Captures</Link><p className="eyebrow mt-4 mb-1">Source evidence</p><h1 className="text-2xl break-words">{evidence.page_title || 'Untitled 1688 listing'}</h1><p className="text-sm text-ink-60 mt-1">Captured {formatDate(capture.createdAt)} · {capture.status === 'needs_review' ? 'Needs review' : capture.status}</p></div><div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] gap-4"><div className="card p-5 space-y-5"><section><p className="label mb-1">Original listing</p><a className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline break-all" href={source.url} target="_blank" rel="noreferrer">{source.url}<ExternalLink size={14} className="shrink-0" /></a></section><section><p className="label mb-1">Visible supplier name</p><p className="text-sm">{evidence.supplier_name_visible || 'Not detected — confirm with supplier.'}</p></section><section><p className="label mb-1">Selected option shown on page</p><p className="text-sm whitespace-pre-wrap">{evidence.selected_options_visible || 'Not detected — confirm the SKU.'}</p></section><section><p className="label mb-1">Rendered page text</p><p className="text-sm whitespace-pre-wrap break-words max-h-96 overflow-y-auto">{evidence.visible_text || 'No rendered text was captured.'}</p></section><p className="text-xs text-ink-60">Review this evidence and confirm supplier facts before asking Codex to create the inactive OC supplier/product/quote draft through the corporate-gift workflow.</p></div><aside className="space-y-4"><div className="card p-4"><p className="label mb-2">Evidence files</p>{capture.screenshot_url ? <a href={capture.screenshot_url} target="_blank" rel="noreferrer"><img className="w-full border border-warm-grey" src={capture.screenshot_url} alt="Visible 1688 page at capture time" /></a> : <p className="text-sm text-ink-60">Screenshot unavailable.</p>}<p className="text-xs text-ink-60 mt-3">{evidence.image_urls?.length || 0} source image URL{evidence.image_urls?.length === 1 ? '' : 's'} recorded</p></div>{source.shop_url && <div className="card p-4"><p className="label mb-1">Shop link</p><a className="text-sm text-brand-600 hover:underline break-all" href={source.shop_url} target="_blank" rel="noreferrer">Open shop</a></div>}</aside></div></div>
}
