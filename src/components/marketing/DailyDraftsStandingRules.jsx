import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react'

// Presentation only. The page owns rule state, approval, loading and all writes.
export default function DailyDraftsStandingRules({
  memoryPanelOpen, setMemoryPanelOpen, pendingRules, activeRules, memoryRuleBusy,
  editingRuleId, setEditingRuleId, editingRuleText, setEditingRuleText,
  newRuleText, setNewRuleText, handleApproveRule, handleRejectRule,
  handleDisableRule, handleDeleteRule, handleSaveRuleEdit, handleAddRuleDirect,
  maxActiveRules: MAX_ACTIVE_RULES,
}) {
  return (
    <div className="card p-4 space-y-3">
      <button type="button" onClick={() => setMemoryPanelOpen(!memoryPanelOpen)}
        className="w-full flex items-center justify-between text-sm font-semibold text-ink">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles size={14} className="text-purple-500" /> Draft memory — standing rules
          {pendingRules.length > 0 && (
            <span className="text-2xs font-normal bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
              {pendingRules.length} pending review
            </span>
          )}
        </span>
        {memoryPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {memoryPanelOpen && (
        <div className="space-y-4">
          {pendingRules.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-ink-60">Pending — not used in any draft yet</p>
              {pendingRules.map(r => (
                <div key={r.id} className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-none px-2.5 py-1.5">
                  <span className="min-w-0 flex-1">{r.text}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" disabled={memoryRuleBusy === r.id} onClick={() => handleApproveRule(r.id)}
                      className="text-xs text-green-700 hover:text-green-800 font-medium disabled:opacity-50">Approve</button>
                    <button type="button" disabled={memoryRuleBusy === r.id} onClick={() => handleRejectRule(r.id)}
                      className="text-xs text-ink-60 hover:text-red-600 disabled:opacity-50">Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-60">
              Active — used in every draft/rewrite ({activeRules.length}/{MAX_ACTIVE_RULES})
            </p>
            {activeRules.length === 0 && <p className="text-xs text-ink-60">None yet — approve a pending rule, or add one directly below.</p>}
            {activeRules.map(r => (
              <div key={r.id} className="flex items-start gap-2 text-sm bg-ivory-light rounded-none px-2.5 py-1.5">
                {editingRuleId === r.id ? (
                  <>
                    <input value={editingRuleText} onChange={e => setEditingRuleText(e.target.value)}
                      className="input flex-1 text-sm py-1" autoFocus />
                    <button type="button" onClick={() => handleSaveRuleEdit(r.id)} className="text-xs text-brand-600 font-medium shrink-0">Save</button>
                    <button type="button" onClick={() => setEditingRuleId(null)} className="text-xs text-ink-60 shrink-0">Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1">{r.text}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => { setEditingRuleId(r.id); setEditingRuleText(r.text) }}
                        className="text-xs text-ink-60 hover:text-brand-600">Edit</button>
                      <button type="button" disabled={memoryRuleBusy === r.id} onClick={() => handleDisableRule(r.id)}
                        className="text-xs text-ink-60 hover:text-amber-600 disabled:opacity-50">Disable</button>
                      <button type="button" disabled={memoryRuleBusy === r.id} onClick={() => handleDeleteRule(r.id)}
                        className="text-xs text-ink-60 hover:text-red-600 disabled:opacity-50">Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1 border-t border-ivory-dark">
            <input value={newRuleText} onChange={e => setNewRuleText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddRuleDirect()}
              placeholder="Add a rule directly, e.g. &quot;Always sign off as Eddie, never 'The Crystocraft Team'&quot;"
              className="input flex-1 text-sm" />
            <button type="button" onClick={handleAddRuleDirect} disabled={!newRuleText.trim()} className="btn-secondary text-xs px-3">
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
