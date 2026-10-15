import { readAiResponse } from '../aiResponse'
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { authHeader } from '../firebase'
import { MARKETING_DESC_MAXLEN } from '../constants'

export default function MarketingCopyEditor({ product, source = 'corporate', value = '', onChange }) {
  const [instructions, setInstructions] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null)
  const rewriting = Boolean(value.trim())

  async function writeCopy() {
    if (loading || !product.name?.trim()) return
    setLoading(true); setError(''); setDraft(null)
    try {
      const response = await fetch(rewriting ? '/api/rewrite-section' : '/api/generate-marketing-copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify(rewriting ? {
          section_type: 'marketing_description', body: value,
          guidance: instructions.trim() || 'Refine the current copy using the supplied product facts.',
          context: `Product: ${product.name}\nCategory: ${product.category || ''}\nSpec: ${product.description || ''}\nSize: ${product.size || ''}\nCrystal: ${product.crystal_type || ''}\nFinishes: ${product.finishes || ''}`,
          max_chars: MARKETING_DESC_MAXLEN,
        } : { product, source, instructions: instructions.trim() }),
      })
      const data = await readAiResponse(response)
      const text = rewriting ? data?.body : data?.marketing_description
      if (typeof text !== 'string' || !text.trim() || text.length > MARKETING_DESC_MAXLEN) {
        throw new Error('The AI did not return usable copy within 300 characters. Please try again. Your current copy has been kept.')
      }
      setDraft(text)
    } catch (err) { setError(err.message || 'AI writing failed. Please try again.') }
    finally { setLoading(false) }
  }

  return <div className="space-y-2">
    <label className="label" htmlFor="marketing-copy">Marketing Description</label>
    <textarea id="marketing-copy" className="input min-h-[96px]" rows={4} value={value}
      maxLength={MARKETING_DESC_MAXLEN} onChange={e => { onChange(e.target.value); setDraft(null) }}
      placeholder="Customer-facing copy for the catalogue and storefront" />
    <p className="text-2xs text-ink-60 text-right">{value.length}/{MARKETING_DESC_MAXLEN}</p>
    <label className="label" htmlFor="marketing-ai-instructions">AI instructions (optional)</label>
    <textarea id="marketing-ai-instructions" className="input text-sm" rows={2} value={instructions}
      onChange={e => setInstructions(e.target.value)} placeholder="E.g. Highlight the soft, low-pitched ring when two glasses are gently clinked." />
    <p className="text-xs text-ink-60">{rewriting
      ? 'Describe what to change in the current copy. Review the draft before using it.'
      : 'Describe what to emphasise. The AI uses the product details and available image.'}</p>
    <button type="button" onClick={writeCopy} disabled={loading || !product.name?.trim()}
      className="text-xs px-3 py-1.5 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-40 inline-flex items-center gap-1">
      <Sparkles size={13} />{loading ? 'Writing draft…' : rewriting ? 'AI Rewrite' : 'AI Write'}
    </button>
    {!product.name?.trim() && <p className="text-xs text-ink-60">Enter a product name first to enable AI writing.</p>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    {draft !== null && <div className="border border-brand-100 p-3 bg-brand-50 space-y-2">
      <p className="text-xs font-medium text-brand-700">AI draft · {draft.length}/{MARKETING_DESC_MAXLEN}</p>
      <p className="text-sm whitespace-pre-wrap" aria-label="AI draft">{draft}</p>
      <div className="flex gap-2">
        <button type="button" className="text-xs px-3 py-1.5 bg-brand-600 text-white" onClick={() => { onChange(draft); setDraft(null) }}>Use this copy</button>
        <button type="button" className="text-xs px-3 py-1.5 border border-warm-grey" onClick={() => setDraft(null)}>Discard</button>
      </div>
      <p className="text-xs text-ink-60">Use this copy to put it in the form, then save the product to publish it.</p>
    </div>}
  </div>
}
