import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Loader2, Pencil, Trash2, Check, X } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import ConfirmDialog from '../components/ConfirmDialog'
import { loadTagStats, renameTagEverywhere, deleteTagEverywhere } from '../domain/customer'
import { suggestTagMerges } from '../tagApi'

// V8.2 — customer tags are entirely free-typed (CustomerForm.jsx dropped its
// fixed picklist groups the same cycle, in favor of autocomplete over
// whatever's already in use) and accumulated for years with no vocabulary
// control, so the same real fact ends up spelled several different ways
// across customers. This page: see everything in use with counts, ask
// DeepSeek to propose merge groups (never applied without a review), and
// rename/delete a tag everywhere by hand for anything the AI pass doesn't
// catch or gets wrong.
export default function TagManager() {
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [groups, setGroups] = useState(null) // AI suggestions, editable, null until requested
  const [applyingKey, setApplyingKey] = useState(null)
  const [renaming, setRenaming] = useState(null) // tag being renamed
  const [renameValue, setRenameValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // tag pending delete confirmation

  async function refresh() {
    setLoading(true)
    setStats(await loadTagStats())
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  const tags = stats

  async function handleSuggest() {
    setSuggesting(true)
    setSuggestError('')
    try {
      const raw = await suggestTagMerges(tags.map(s => s.tag))
      setGroups(raw.map(g => ({ ...g, canonical: g.canonical, accepted: true })))
    } catch (e) {
      setSuggestError(e.message)
    } finally {
      setSuggesting(false)
    }
  }

  async function applyGroup(group, idx) {
    setApplyingKey(idx)
    try {
      for (const tag of group.tags) {
        if (tag === group.canonical) continue
        await renameTagEverywhere(tag, group.canonical)
      }
      setGroups(gs => gs.filter((_, i) => i !== idx))
      await refresh()
    } finally {
      setApplyingKey(null)
    }
  }

  function startRename(tag) {
    setRenaming(tag)
    setRenameValue(tag)
  }
  async function commitRename() {
    const next = renameValue.trim()
    if (next && next !== renaming) await renameTagEverywhere(renaming, next)
    setRenaming(null)
    await refresh()
  }
  async function commitDelete(tag) {
    setConfirmDelete(null)
    await deleteTagEverywhere(tag)
    await refresh()
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      {loading && <LoadingBar />}
      <div className="mb-6">
        <Link to="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl font-bold text-ink mt-1">Manage Tags</h1>
        <p className="text-sm text-ink-60 mt-0.5">
          {tags.length} tag{tags.length === 1 ? '' : 's'} in use across all customers.
        </p>
      </div>

      {/* AI merge suggestions */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-semibold text-ink-80">AI-suggested merges</p>
            <p className="text-xs text-ink-60 mt-0.5">
              Finds custom tags that likely mean the same thing (casing, wording, near-duplicates) and proposes one
              spelling. Nothing changes until you apply a group.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSuggest}
            disabled={suggesting || tags.length < 2}
            className="btn-secondary text-sm shrink-0 flex items-center gap-1.5"
          >
            {suggesting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {suggesting ? 'Thinking…' : 'Suggest merges'}
          </button>
        </div>

        {suggestError && <p className="text-xs text-red-600 mt-2">{suggestError}</p>}

        {groups && groups.length === 0 && !suggesting && (
          <p className="text-sm text-ink-60 mt-3">No likely duplicates found.</p>
        )}

        {groups && groups.length > 0 && (
          <div className="space-y-3 mt-4">
            {groups.map((g, idx) => (
              <div key={idx} className="border border-warm-grey rounded-none p-3">
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {g.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-ivory-dark text-ink-70">{t}</span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-60">→</span>
                  <input
                    className="input text-sm py-1 flex-1"
                    value={g.canonical}
                    onChange={e => setGroups(gs => gs.map((x, i) => i === idx ? { ...x, canonical: e.target.value } : x))}
                  />
                  <button
                    type="button"
                    onClick={() => applyGroup(g, idx)}
                    disabled={applyingKey === idx || !g.canonical.trim()}
                    className="btn-primary text-xs px-3 py-1.5 shrink-0"
                  >
                    {applyingKey === idx ? 'Applying…' : 'Apply'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroups(gs => gs.filter((_, i) => i !== idx))}
                    className="text-ink-60 hover:text-ink-70 shrink-0"
                    title="Dismiss"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Every tag, manual rename/delete */}
      <div className="card p-5">
        <p className="text-sm font-semibold text-ink-80 mb-3">All tags ({tags.length})</p>
        {tags.length === 0 ? (
          <p className="text-sm text-ink-60">No tags yet.</p>
        ) : (
          <div className="divide-y divide-warm-grey">
            {tags.map(s => (
              <div key={s.tag} className="flex items-center justify-between py-2.5 gap-3">
                {renaming === s.tag ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      autoFocus
                      className="input text-sm py-1 flex-1"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
                    />
                    <button type="button" onClick={commitRename} className="text-brand-600 hover:text-brand-800">
                      <Check size={16} />
                    </button>
                    <button type="button" onClick={() => setRenaming(null)} className="text-ink-60 hover:text-ink-70">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <span className="text-sm text-ink">{s.tag}</span>
                      <span className="text-xs text-ink-60 ml-2">
                        {s.count} customer{s.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => startRename(s.tag)} className="text-ink-60 hover:text-ink-70" title="Rename everywhere">
                        <Pencil size={14} />
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(s.tag)} className="text-ink-60 hover:text-red-600" title="Delete everywhere">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>


      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete}" from every customer that has it (${tags.find(s => s.tag === confirmDelete)?.count || 0})? This can't be undone.`}
          confirmLabel="Delete everywhere"
          onConfirm={() => commitDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
