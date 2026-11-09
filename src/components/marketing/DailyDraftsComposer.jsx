import { Bookmark, Loader2, Sparkles } from 'lucide-react'

// Presentation only. DailyDrafts retains state, service calls and write handlers.
export function DailyDraftsTopicControls({
  topicTemplates, selectedTemplateId, handleSelectTopicTemplate, topic, setTopic,
  setSelectedTemplateId, handleDraftTopic, drafting, hasMaster,
  handleSaveTopicTemplate, handleDeleteTopicTemplate,
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-60 mb-1">Topic</label>
      {topicTemplates.length > 0 && (
        <select aria-label="Saved topics" value={selectedTemplateId} onChange={e => handleSelectTopicTemplate(e.target.value)}
          className="input w-full text-sm mb-1.5">
          <option value="">Saved topics…</option>
          {topicTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <textarea value={topic} onChange={e => { setTopic(e.target.value); setSelectedTemplateId('') }} rows={2}
        placeholder={'e.g. "News and update on what we\'ve been up to" or "Invite long-time customers to try the new customer portal"'}
        className="input w-full text-sm" />
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button onClick={handleDraftTopic} disabled={drafting || !topic.trim()}
          className="btn-primary inline-flex items-center gap-1.5">
          {drafting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {drafting ? 'Drafting…' : hasMaster ? 'Draft again' : 'Draft with AI'}
        </button>
        <button type="button" onClick={handleSaveTopicTemplate} disabled={!topic.trim()}
          className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5">
          <Bookmark size={13} />
          {topicTemplates.some(t => t.id === selectedTemplateId) ? 'Update saved topic' : 'Save as reusable topic'}
        </button>
        {topicTemplates.some(t => t.id === selectedTemplateId) && (
          <button type="button" onClick={handleDeleteTopicTemplate}
            className="text-xs text-ink-60 hover:text-red-600">
            Delete saved topic
          </button>
        )}
      </div>
    </div>
  )
}

export function DailyDraftsMasterFields({ masterSubject, setMasterSubject, masterBody, setMasterBody }) {
  return (
    <>
      <input value={masterSubject} onChange={e => setMasterSubject(e.target.value)}
        className="input w-full text-sm font-medium" placeholder="Subject" />
      <textarea value={masterBody} onChange={e => setMasterBody(e.target.value)} rows={4}
        className="input w-full text-sm" placeholder="Message" />
    </>
  )
}
