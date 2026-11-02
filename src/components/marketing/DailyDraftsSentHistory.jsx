import { CheckCircle2, Loader2, Eye, MousePointerClick, AlertTriangle } from 'lucide-react'
import SourceBadge from './DailyDraftSourceBadge'

const ENGAGEMENT_BADGES = [
  { key: 'delivered', label: 'Delivered', Icon: CheckCircle2 },
  { key: 'opened', label: 'Opened', Icon: Eye },
  { key: 'clicked', label: 'Clicked', Icon: MousePointerClick },
  { key: 'bounced', label: 'Bounced', Icon: AlertTriangle },
  // 'complained' was written by resend-webhook.js from day one but never
  // rendered anywhere in the app — a spam complaint silenced/flagged the
  // record server-side with no visible trail (found during the SU-08
  // interaction-log audit, 2026-08-18).
  { key: 'complained', label: 'Complained', Icon: AlertTriangle },
]

// Presentation only. The page owns reply state and all logging/writes.
export default function DailyDraftsSentHistory({
  sentDrafts, replyFormOpenId, busyId, setReplyFormOpenId,
  replyChannel, setReplyChannel, replyText, setReplyText, handleLogReply,
  replyChannels: REPLY_CHANNELS,
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm text-ink">Sent ({sentDrafts.length})</h2>
      {sentDrafts.length === 0 && <div className="text-sm text-ink-60">Nothing sent yet.</div>}
      {sentDrafts.map(d => {
        const isReplyOpen = replyFormOpenId === d.id
        const isBusy = busyId === d.id
        return (
          <div key={d.id} className="card p-3 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm text-ink truncate">
                  {d.customerName} <span className="text-ink-60">— {d.productName || d.topicLabel}</span>
                  <SourceBadge source={d.source} />
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {ENGAGEMENT_BADGES.map(({ key, label, Icon }) => (
                    <span key={key} className={`inline-flex items-center gap-1 text-2xs rounded-none px-1.5 py-0.5 ${
 d.engagement?.[key]
                        ? ((key === 'bounced' || key === 'complained') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700')
                        : 'bg-ivory text-platinum'
                    }`}>
                      <Icon size={11} /> {label}
                    </span>
                  ))}
                  {d.repliedAt && (
                    <span className="inline-flex items-center gap-1 text-2xs rounded-none px-1.5 py-0.5 bg-brand-50 text-brand-700">
                      <CheckCircle2 size={11} /> Replied{d.repliedChannel ? ` via ${d.repliedChannel}` : ''}
                    </span>
                  )}
                </div>
              </div>
              {!d.repliedAt && (
                <button onClick={() => setReplyFormOpenId(isReplyOpen ? null : d.id)}
                  className="text-xs text-ink-60 hover:text-brand-600 shrink-0 whitespace-nowrap">
                  {isReplyOpen ? 'Cancel' : 'Log a reply'}
                </button>
              )}
            </div>

            {isReplyOpen && (
              <div className="border border-ivory-dark rounded-none p-3 bg-ivory-light space-y-2">
                <div className="flex gap-2 flex-wrap">
                  {REPLY_CHANNELS.map(ch => (
                    <button key={ch} type="button"
                      onClick={() => setReplyChannel(prev => ({ ...prev, [d.id]: ch }))}
                      className={`text-xs rounded-none px-2 py-1 border ${
 (replyChannel[d.id] || REPLY_CHANNELS[0]) === ch
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-ivory-dark text-ink-60 hover:bg-white'
                      }`}>
                      {ch}
                    </button>
                  ))}
                </div>
                <textarea value={replyText[d.id] || ''}
                  onChange={e => setReplyText(prev => ({ ...prev, [d.id]: e.target.value }))}
                  placeholder="Paste their reply here (optional) — this and the channel get logged to their CRM record"
                  rows={2} className="input w-full text-sm"
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                  data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
                  data-lpignore="true" data-1p-ignore="true" />
                <button onClick={() => handleLogReply(d)} disabled={isBusy} className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1.5">
                  {isBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Log reply
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
