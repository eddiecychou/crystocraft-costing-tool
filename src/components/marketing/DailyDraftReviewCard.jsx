import {
  Send, Loader2, SkipForward, Sparkles, X, Link2, Upload, MessageCircle,
  CheckCircle2, Bookmark, BellOff, Mail, FileText, Receipt, Smartphone, UserPlus, Check,
  FlaskConical,
} from 'lucide-react'
import SourceBadge from './DailyDraftSourceBadge'
import { CustomerPicker } from '../../pages/CustomerAccounts'

// Presentation only. Page-owned state and callbacks retain all workflow/write boundaries.
export default function DailyDraftReviewCard({ d, fields, view, actions, limits }) {
  const {
    isBusy, isChatOpen, isChatBusy, history, isAddCustomerOpen, draftUploading,
    photoPickerOpenId, linkFormOpenId, productImagesCache, draftLinkUrl, draftLinkTitle, busyId,
    testSentId, addCustomerDone, whatsappOpened, whatsappLogged, addCustomerMode,
    addCustomerBusy, pickerCustomers, addCustomerPickId, addCustomerError, chatInput,
  } = view
  const {
    setField, removeDraftImage, setPhotoPickerOpenId, ensureProductImages, handleDraftUpload,
    removeDraftLink, setLinkFormOpenId, toggleDraftImage, setDraftLinkUrl, setDraftLinkTitle,
    applyDraftLink, handleSend, handleSkip, handleBlockOutreach, handleSendTest, openAddCustomer,
    setChatOpenId, handleWhatsappOpen, handleLogWhatsapp, setAddCustomerMode,
    setAddCustomerError, handleCreateNewCustomer, setAddCustomerPickId, handleAddAsContact,
    handleSaveNote, handleRememberConclusion, handleRememberRule, setChatInput, handleChatSend,
  } = actions
  const { maxAttachedImages: MAX_ATTACHED_IMAGES, blockDays: BLOCK_DAYS } = limits
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium text-ink truncate">
            {d.customerName} <span className="text-ink-60 font-normal">— {d.customerEmail}</span>
            <SourceBadge source={d.source} />
          </div>
          <div className="text-xs text-ink-60 mt-0.5">
            {d.productName || d.topicLabel} · fit {Math.round((d.fitScore || 0) * 100)}%
            {d.fitReason && <span className="text-ink-60"> — {d.fitReason}</span>}
          </div>
          {d.contextSources?.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              {d.contextSources.includes('email') && (
                <span className="inline-flex items-center gap-1 text-2xs text-ink-60" title="This draft used the customer's ingested email history">
                  <Mail size={11} /> Email history
                </span>
              )}
              {d.contextSources.includes('whatsapp') && (
                <span className="inline-flex items-center gap-1 text-2xs text-ink-60" title="This draft used the customer's imported WhatsApp history">
                  <Smartphone size={11} /> WhatsApp history
                </span>
              )}
              {d.contextSources.includes('notes') && (
                <span className="inline-flex items-center gap-1 text-2xs text-ink-60" title="This draft used the CRM notes field">
                  <FileText size={11} /> CRM notes
                </span>
              )}
              {d.contextSources.includes('invoices') && (
                <span className="inline-flex items-center gap-1 text-2xs text-ink-60" title="This draft used recent ERP order history">
                  <Receipt size={11} /> Recent orders
                </span>
              )}
              {d.contextSources.includes('memory') && (
                <span className="inline-flex items-center gap-1 text-2xs text-ink-60" title="This draft used the contact's saved AI writing preferences">
                  <Sparkles size={11} /> Memory
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <input value={fields.subject} onChange={e => setField(d.id, 'subject', e.target.value)}
        className="input w-full text-sm font-medium" />
      <textarea value={fields.body} onChange={e => setField(d.id, 'body', e.target.value)}
        rows={4} className="input w-full text-sm" />
      <div className="flex items-center gap-2 flex-wrap">
        {(fields.imageUrls || []).map(url => (
          <div key={url} className="relative">
            <img src={url} alt="" className="w-10 h-10 rounded-none object-cover border border-ivory-dark" />
            <button type="button" onClick={() => removeDraftImage(d, url)}
              className="absolute -top-1.5 -right-1.5 bg-white rounded-full border border-ivory-dark text-ink-60 hover:text-red-600">
              <X size={11} />
            </button>
          </div>
        ))}
        {(fields.imageUrls || []).length < MAX_ATTACHED_IMAGES && (
          d.productId ? (
            <button type="button"
              onClick={() => { setPhotoPickerOpenId(photoPickerOpenId === d.id ? null : d.id); ensureProductImages(d.productId, d.productSource) }}
              className="text-xs text-ink-60 hover:text-brand-600 border border-dashed border-ivory-dark rounded-none px-2 py-1.5">
              + Photo
            </button>
          ) : (
            <label className="text-xs text-ink-60 hover:text-brand-600 border border-dashed border-ivory-dark rounded-none px-2 py-1.5 cursor-pointer inline-flex items-center gap-1">
              {draftUploading === d.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Upload
              <input type="file" accept="image/*" className="hidden" disabled={draftUploading === d.id}
                onChange={e => { handleDraftUpload(d, e.target.files?.[0]); e.target.value = '' }} />
            </label>
          )
        )}
        {(fields.links || []).map(l => (
          <span key={l.url} className="inline-flex items-center gap-1 text-xs text-ink-60 bg-ivory-light rounded-none px-2 py-1">
            <Link2 size={11} /> {l.title}
            <button type="button" onClick={() => removeDraftLink(d, l.url)} className="text-ink-60 hover:text-red-600">
              <X size={11} />
            </button>
          </span>
        ))}
        <button type="button" onClick={() => setLinkFormOpenId(linkFormOpenId === d.id ? null : d.id)}
          className="text-xs text-ink-60 hover:text-brand-600 border border-dashed border-ivory-dark rounded-none px-2 py-1.5">
          + Link
        </button>
      </div>

      {photoPickerOpenId === d.id && (
        <div className="flex flex-wrap gap-2 border border-ivory-dark rounded-none p-2">
          {(productImagesCache[`${d.productSource || 'corporate'}:${d.productId}`] || []).map(img => (
            <button key={img.id || img.file_url} type="button" onClick={() => toggleDraftImage(d, img.file_url)}
              className={`relative w-12 h-12 rounded-none overflow-hidden border-2 ${(fields.imageUrls || []).includes(img.file_url) ? 'border-brand-600' : 'border-transparent'}`}>
              <img src={img.file_url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
          {!(productImagesCache[`${d.productSource || 'corporate'}:${d.productId}`] || []).length && <div className="text-xs text-ink-60 py-1">No public photos for this product.</div>}
        </div>
      )}

      {linkFormOpenId === d.id && (
        <div className="border border-ivory-dark rounded-none p-2 space-y-2">
          <input value={draftLinkUrl[d.id] || ''}
            onChange={e => setDraftLinkUrl(prev => ({ ...prev, [d.id]: e.target.value }))}
            placeholder="https://…" className="input w-full text-sm" />
          <input value={draftLinkTitle[d.id] || ''}
            onChange={e => setDraftLinkTitle(prev => ({ ...prev, [d.id]: e.target.value }))}
            placeholder="Link text (optional)" className="input w-full text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={() => applyDraftLink(d)} disabled={!(draftLinkUrl[d.id] || '').trim()} className="btn-secondary text-xs py-1.5 px-3">
              Attach link
            </button>
            <button type="button" onClick={() => setLinkFormOpenId(null)} className="text-xs text-ink-60 hover:text-brand-600">
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* flex-wrap: this row overflowed horizontally on both desktop
          and mobile once "Send test to myself" (V8.7) joined
          Send/Skip/Already in contact — four full-width buttons plus
          the trailing actions never fit one line below ~1400px, and
          a non-wrapping flex row just clips/scrolls instead of
          reflowing. gap-y-2 gives wrapped rows breathing room. */}
      <div className="flex items-center gap-2 flex-wrap gap-y-2">
        <button onClick={() => handleSend(d)} disabled={isBusy} className="btn-primary shrink-0 inline-flex items-center gap-1.5">
          {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {isBusy ? 'Sending…' : 'Send'}
        </button>
        <button onClick={() => handleSkip(d)} disabled={isBusy} className="btn-secondary shrink-0 inline-flex items-center gap-1.5">
          <SkipForward size={14} /> Skip
        </button>
        <button onClick={() => handleBlockOutreach(d)} disabled={isBusy}
          title={`Already talking to them directly — don't suggest for ${BLOCK_DAYS} days`}
          className="btn-secondary shrink-0 inline-flex items-center gap-1.5">
          <BellOff size={14} /> Already in contact
        </button>
        {(() => {
          const isTestBusy = busyId === `test-${d.id}`
          return (
            <button onClick={() => handleSendTest(d)} disabled={isBusy || isTestBusy}
              title="Send this exact email to your own inbox first — nothing here is sent to the customer or recorded"
              className="btn-secondary shrink-0 inline-flex items-center gap-1.5">
              {isTestBusy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
              {isTestBusy ? 'Sending test…' : 'Send test to myself'}
            </button>
          )
        })()}
        {testSentId === d.id && (
          <span className="text-xs text-green-700 inline-flex items-center gap-1">
            <CheckCircle2 size={13} /> Test sent — check your inbox
          </span>
        )}
        {/* w-full on mobile: forces this group onto its own line
            instead of squeezing beside the action buttons above once
            wrapped — sm:w-auto/sm:ml-auto restores the "push right"
            layout once there's room (desktop). */}
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-3 flex-wrap">
          {d.source === 'contact' && !addCustomerDone[d.id] && (
            <button type="button" onClick={() => openAddCustomer(d)}
              className="text-xs text-ink-60 hover:text-brand-600 inline-flex items-center gap-1">
              <UserPlus size={13} /> {isAddCustomerOpen ? 'Close' : 'Add to Customers'}
            </button>
          )}
          {addCustomerDone[d.id] && (
            <span className="text-xs text-green-600 inline-flex items-center gap-1">
              <Check size={13} /> {addCustomerDone[d.id]}
            </span>
          )}
          <button onClick={() => setChatOpenId(isChatOpen ? null : d.id)}
            className="text-xs text-ink-60 hover:text-brand-600 inline-flex items-center gap-1">
            <MessageCircle size={13} /> {isChatOpen ? 'Close' : 'Discuss with AI'}
          </button>
        </div>
      </div>

      {/* WhatsApp quick access (Draft Daily WhatsApp channel support,
          2026-08-19) — a manual open/copy action, never an auto-send.
          Both numbers known -> two labelled buttons, never guessed.
          Only one -> a single labelled button. Neither -> nothing
          (no dead button). Legacy unclassified whatsapp -> a neutral
          "WhatsApp" button, never relabeled Personal/Business without
          evidence. */}
      {(() => {
        const hasPersonal = !!d.whatsapp_personal
        const hasBusiness = !!d.whatsapp_business
        const hasNeutral = !hasPersonal && !hasBusiness && !!d.whatsapp
        if (!hasPersonal && !hasBusiness && !hasNeutral) return null
        const chip = (label, channel, number) => (
          <span key={channel} className="inline-flex items-center gap-1 rounded-full border border-warm-grey pl-1 pr-0.5 py-0.5">
            <button type="button" onClick={() => handleWhatsappOpen(d, channel, number)}
              className="text-xs text-ink-80 hover:text-brand-700 inline-flex items-center gap-1 px-1.5 py-0.5">
              <Smartphone size={12} />{label}
            </button>
            <button type="button" onClick={() => navigator.clipboard.writeText(number)}
              title={`Copy ${label} number`} className="text-platinum hover:text-brand-600 px-1 py-0.5 text-2xs">
              Copy
            </button>
          </span>
        )
        return (
          <div className="flex items-center gap-2 flex-wrap -mt-1">
            {hasPersonal && chip('WhatsApp Personal', 'personal', d.whatsapp_personal)}
            {hasBusiness && chip('WhatsApp Business', 'business', d.whatsapp_business)}
            {hasNeutral && chip('WhatsApp', 'unknown', d.whatsapp)}
            {whatsappOpened[d.id] && !whatsappLogged[d.id] && (
              <button type="button" onClick={() => handleLogWhatsapp(d)}
                className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
                <Check size={12} /> Log WhatsApp outreach
              </button>
            )}
            {whatsappLogged[d.id] && (
              <span className="text-xs text-green-600 inline-flex items-center gap-1">
                <Check size={12} /> Logged
              </span>
            )}
          </div>
        )
      })()}

      {isAddCustomerOpen && (
        <div className="border border-ivory-dark rounded-none p-3 bg-ivory-light space-y-2">
          <div className="flex gap-1.5">
            {[{ key: 'new', label: 'Create as new customer' }, { key: 'existing', label: 'Add as a contact on an existing customer' }].map(opt => (
              <button key={opt.key} type="button" onClick={() => { setAddCustomerMode(opt.key); setAddCustomerError('') }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
 addCustomerMode === opt.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink-70 border-warm-grey hover:border-ink-60'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          {addCustomerMode === 'new' ? (
            <>
              <p className="text-xs text-ink-60">
                Creates a new customer record from {d.customerName}'s lead info (company/name/email/phone/country) and links this lead to it.
              </p>
              <button type="button" onClick={() => handleCreateNewCustomer(d)} disabled={addCustomerBusy} className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                {addCustomerBusy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                {addCustomerBusy ? 'Creating…' : 'Create customer'}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-ink-60">
                Appends {d.customerName} as an extra contact on an existing customer — for a second person at a company already in the CRM.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <CustomerPicker customers={pickerCustomers} value={addCustomerPickId} onChange={setAddCustomerPickId} />
                <button type="button" onClick={() => handleAddAsContact(d)} disabled={addCustomerBusy || !addCustomerPickId} className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                  {addCustomerBusy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                  {addCustomerBusy ? 'Adding…' : 'Add contact'}
                </button>
              </div>
            </>
          )}
          {addCustomerError && <p className="text-xs text-red-600">{addCustomerError}</p>}
        </div>
      )}

      {isChatOpen && (
        <div className="border border-ivory-dark rounded-none p-3 bg-ivory-light space-y-2">
          {history.length > 0 && (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {history.map((h, i) => (
                <div key={i} className={`text-sm ${h.role === 'assistant' ? 'text-ink-80' : 'text-ink'}`}>
                  <div className="flex items-start gap-1.5">
                    <span className="font-medium shrink-0">{h.role === 'assistant' ? 'AI:' : 'You:'}</span>
                    <span className="min-w-0">{h.content}</span>
                    {h.role === 'user' && (
                      <span className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => handleSaveNote(d, h.content)}
                          title="Save this as a note on the customer record"
                          className="text-ink-60 hover:text-brand-600">
                          <Bookmark size={12} />
                        </button>
                        <button type="button" onClick={() => handleRememberConclusion(d, h.content)}
                          title="Remember for THIS draft only (feeds this draft's rewrite chat)"
                          className="text-ink-60 hover:text-blue-600">
                          <Bookmark size={12} className="fill-current" style={{ opacity: 0.3 }} />
                        </button>
                        <button type="button" onClick={() => handleRememberRule(h.content)}
                          title="Remember as a standing rule for every future draft (goes to review first)"
                          className="text-ink-60 hover:text-purple-600">
                          <Sparkles size={12} />
                        </button>
                      </span>
                    )}
                  </div>
                  {/* h.applied === false means the AI's own reply text
                      claimed a change while returning null for both
                      subject and body — a real, observed failure mode
                      (2026-08-22) where the model says "I've updated
                      the email" but the draft above never moves. This
                      makes that mismatch visible instead of silently
                      confusing — say it again or reword the request. */}
                  {h.role === 'assistant' && h.applied === false && (
                    <p className="text-2xs text-amber-700 ml-6 mt-0.5">
                      ⚠ No actual change was applied to the draft above — try rephrasing the request.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {/* This input kept getting a browser-extension icon rendered ON TOP of
                typed text, mid-line — first seen with Grammarly/1Password (their
                data-gramm / data-lpignore / data-1p-ignore attributes below), still
                happening 2026-08-13 with a different extension's "···" overlay.
                These per-extension opt-out attributes aren't 100% reliable (some
                extensions attach via a MutationObserver that races a freshly-mounted
                input like this one — only rendered at all once isChatOpen is true —
                rather than respecting the attribute at mount), so this is now a
                broader set covering the other common offenders (Dashlane, Bitwarden,
                Microsoft Editor) rather than trusting any single one to be enough.
                If a specific extension keeps winning the race regardless, the actual
                fix is disabling it for this site — not something the app can force. */}
            {/* Was a single-line <input> — a long message just scrolled
                horizontally instead of wrapping, so the tail of what
                you'd typed ended up visually hidden behind a browser
                extension's icon overlay at the right edge (reported
                2026-08-22). A wrapping textarea sidesteps that
                entirely — nothing to scroll behind. Enter still
                sends; Shift+Enter inserts a real line break. */}
            <textarea value={chatInput[d.id] || ''}
              onChange={e => setChatInput(prev => ({ ...prev, [d.id]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isChatBusy) handleChatSend(d) } }}
              placeholder="e.g. they prefer WhatsApp, not email — mention that instead"
              rows={2}
              className="input w-full text-sm resize-none" autoFocus
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              name="daily-drafts-chat-input"
              data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
              data-lpignore="true" data-1p-ignore="true"
              data-dashlane-ignore="true" data-bwignore="true" data-form-type="other"
              data-ms-editor="false" />
            <button type="button" onClick={() => handleChatSend(d)} disabled={isChatBusy} className="btn-secondary shrink-0 self-end">
              {isChatBusy ? <Loader2 size={14} className="animate-spin" /> : 'Send'}
            </button>
          </div>
          <div className="text-2xs text-ink-60">
            The AI only rewrites this email — it never edits the CRM record. Click <Bookmark size={10} className="inline" /> next to your own message to save it as a note instead.
          </div>
        </div>
      )}
    </div>
  )
}
