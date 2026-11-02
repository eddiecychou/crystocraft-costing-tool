import { Loader2, Sparkles, Trash2 } from 'lucide-react'

// Controlled presentation; the page retains AI sequencing, state and deletion confirmation.
export default function DailyDraftsPendingToolbar({
  pendingCount, bulkRewriteOpen, setBulkRewriteOpen, bulkRewriteInput,
  setBulkRewriteInput, bulkRewriteBusy, bulkRewriteProgress, bulkRewriteError,
  handleBulkRewrite, handleClearAllPending,
}) {
  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <h2 className="text-sm text-ink">Pending review ({pendingCount})</h2>
        {pendingCount > 0 && (
          <div className="flex items-center gap-3">
            <button onClick={() => setBulkRewriteOpen(v => !v)} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
              <Sparkles size={12} /> Bulk rewrite
            </button>
            <button onClick={handleClearAllPending} className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1">
              <Trash2 size={12} /> Clear all pending
            </button>
          </div>
        )}
      </div>

      {bulkRewriteOpen && pendingCount > 0 && (
        <div className="border border-ivory-dark rounded-none p-3 bg-ivory-light space-y-2">
          <p className="text-xs text-ink-60">
            Applies to all {pendingCount} pending draft{pendingCount === 1 ? '' : 's'} — same instruction, sent
            to each one individually (a real AI call per draft, so this takes a moment for a large batch).
          </p>
          <div className="flex gap-2">
            <input
              value={bulkRewriteInput}
              onChange={e => setBulkRewriteInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !bulkRewriteBusy && handleBulkRewrite()}
              placeholder="e.g. sign off with 'Best regards, Eddie' instead"
              className="input w-full text-sm" autoFocus
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              name="bulk-rewrite-input"
              data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
              data-lpignore="true" data-1p-ignore="true"
              data-dashlane-ignore="true" data-bwignore="true" data-form-type="other"
              data-ms-editor="false"
            />
            <button type="button" onClick={handleBulkRewrite} disabled={bulkRewriteBusy || !bulkRewriteInput.trim()} className="btn-secondary shrink-0">
              {bulkRewriteBusy ? <Loader2 size={14} className="animate-spin" /> : 'Apply to all'}
            </button>
          </div>
          {bulkRewriteProgress && (
            <p className="text-xs text-ink-60">Rewrote {bulkRewriteProgress.done} of {bulkRewriteProgress.total}…</p>
          )}
          {bulkRewriteError && <p className="text-xs text-red-600">{bulkRewriteError}</p>}
        </div>
      )}
    </>
  )
}
