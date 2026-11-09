import { Loader2, Sparkles } from 'lucide-react'

// Presentation only. DailyDrafts owns state, eligibility, generation and writes.
export default function DailyDraftsTargeting({
  hasMaster, audienceFilter, setAudienceFilter, categoryFilter, setCategoryFilter,
  categories: CRM_CATEGORIES, targetingNote, setTargetingNote,
  includeAlreadyContacted, setIncludeAlreadyContacted, generating, handleGenerate,
  contactMode='all',setContactMode,contactReview='',
}) {
  return (
    <div className={`card p-5 space-y-4 ${!hasMaster ? 'opacity-50' : ''}`}>
      <h2 className="text-sm text-ink">2. Who do you want to reach?</h2>
      <label className="block text-sm">Contact review<select className="input mt-1 max-w-md" value={contactMode} disabled={!hasMaster||generating} onChange={e=>setContactMode(e.target.value)}><option value="all">Normal targeting and cooldowns</option><option value="quiet90">Existing B2B customers · no recorded contact for 90 days</option></select></label>
      {contactMode==='quiet90'&&<p className="text-xs text-ink-60">B2B companies only; marketing leads and unknown/partial histories are excluded. Contact dates are checked when you generate. Drafting and sending still require your review. {contactReview}</p>}
      {/* Hard pre-filter, not a hint — see handleGenerate's own comment on
          why this can't just be folded into the free-text Targeting note
          below (the AI can ignore/misread free text; this can't be). */}
      <div>
        <label className="block text-xs font-medium text-ink-60 mb-1">Audience</label>
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { v: 'b2b', label: 'B2B customers' },
            { v: 'retail', label: 'Retail customers only' },
            { v: 'all', label: 'Everyone' },
          ].map(opt => (
            <label key={opt.v} className="flex items-center gap-1.5 text-sm text-ink-80">
              <input type="radio" name="audienceFilter" value={opt.v} checked={(contactMode==='quiet90'?'b2b':audienceFilter) === opt.v}
                disabled={!hasMaster||contactMode==='quiet90'} onChange={() => setAudienceFilter(opt.v)} />
              {opt.label}
            </label>
          ))}
        </div>
        {(audienceFilter === 'b2b'||contactMode==='quiet90') && (
          <div className="flex items-center gap-3 flex-wrap mt-2">
            {CRM_CATEGORIES.map(cat => (
              <label key={cat} className="flex items-center gap-1.5 text-xs text-ink-70">
                <input type="checkbox" checked={categoryFilter.includes(cat)} disabled={!hasMaster}
                  onChange={e => setCategoryFilter(prev => e.target.checked ? [...prev, cat] : prev.filter(c => c !== cat))} />
                {cat}
              </label>
            ))}
            <span className="text-2xs text-ink-60">{categoryFilter.length ? '' : '(none checked = all categories)'}</span>
          </div>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-60 mb-1">Targeting (optional)</label>
        <input value={targetingNote} onChange={e => setTargetingNote(e.target.value)} disabled={!hasMaster}
          placeholder='e.g. "Hong Kong corporate gift customers" or "Crystocraft distributors in Europe"'
          className="input w-full md:w-96" />
        <div className="text-2xs text-ink-60 mt-1">Leave blank and DeepSeek picks who's most relevant on its own judgment.</div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-70">
        <input type="checkbox" checked={includeAlreadyContacted} disabled={!hasMaster}
          onChange={e => setIncludeAlreadyContacted(e.target.checked)} />
        Include people already contacted about this (drafted as a reminder, not a repeat pitch)
      </label>
      <button onClick={handleGenerate} disabled={generating || !hasMaster} className="btn-primary inline-flex items-center gap-1.5">
        {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {generating ? 'Generating…' : 'Generate Drafts'}
      </button>
    </div>
  )
}
