import { Bookmark, Loader2, MessageCircle } from 'lucide-react'

// Controlled presentation. DailyDrafts retains AI requests, state and rule approval.
export default function DailyDraftsMasterChat({
  masterChatOpen, setMasterChatOpen, masterChatHistory, handleRememberRule,
  masterChatInput, setMasterChatInput, masterChatBusy, handleMasterChatSend,
}) {
  return (
    <div>
      <button type="button" onClick={() => setMasterChatOpen(!masterChatOpen)}
        className="text-xs text-ink-60 hover:text-brand-600 inline-flex items-center gap-1">
        <MessageCircle size={13} /> {masterChatOpen ? 'Close' : 'Rewrite / fine-tune with AI'}
      </button>
      {masterChatOpen && (
        <div className="border border-ivory-dark rounded-none p-3 bg-ivory-light space-y-2 mt-2">
          {masterChatHistory.length > 0 && (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {masterChatHistory.map((h, i) => (
                <div key={i} className={`text-sm flex items-start gap-1.5 ${h.role === 'assistant' ? 'text-ink-80' : 'text-ink'}`}>
                  <span className="min-w-0"><span className="font-medium">{h.role === 'assistant' ? 'AI:' : 'You:'}</span> {h.content}</span>
                  {h.role === 'user' && (
                    <button type="button" onClick={() => handleRememberRule(h.content)}
                      title="Remember this as a standing rule for every future draft (goes to review first)"
                      className="text-ink-60 hover:text-brand-600 shrink-0">
                      <Bookmark size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input value={masterChatInput} onChange={e => setMasterChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !masterChatBusy && handleMasterChatSend()}
              placeholder="e.g. shorter, and mention the summer catalogue"
              className="input w-full text-sm" autoFocus
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
              data-lpignore="true" data-1p-ignore="true" />
            <button type="button" onClick={handleMasterChatSend} disabled={masterChatBusy} className="btn-secondary shrink-0">
              {masterChatBusy ? <Loader2 size={14} className="animate-spin" /> : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
