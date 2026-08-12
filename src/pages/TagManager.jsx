import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Loader2, Pencil, Trash2, Check, X } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import ConfirmDialog from '../components/ConfirmDialog'
import { loadTagStats, renameTagEverywhere, deleteTagEverywhere } from '../domain/customer'
import { suggestTagMerges } from '../tagApi'

// V8.2 — the custom-tag pile (CustomerForm.jsx's free-typed "Custom" field,
// on top of the fixed TAG_GROUPS picklist) accumulated for years with no
// vocabulary control, so the same real fact ends up spelled several
// different ways across customers. This page: see everything in use with
// counts, ask DeepSeek to propose merge groups (never applied without a
// review), and rename/delete a tag everywhere by hand for anything the AI
// pass doesn't catch or gets wrong.
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

  const customTags = stats.filter(s => !s.picklist)
  const picklistTags = stats.filter(s => s.picklist)

  async function handleSuggest() {
    setSuggesting(true)
    setSuggestError('')
    try {
      const raw = await suggestTagMerges(customTags.map(s => s.tag))
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
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Manage Tags</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {customTags.length} custom tag{customTags.length === 1 ? '' : 's'} in use, plus {picklistTags.length} from the fixed picklist.
        </p>
      </div>

      {/* AI merge suggestions */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-semibold text-gray-700">AI-suggested merges</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Finds custom tags that likely mean the same thing (casing, wording, near-duplicates) and proposes one
              spelling. Nothing changes until you apply a group.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSuggest}
            disabled={suggesting || customTags.length < 2}
            className="btn-secondary text-sm shrink-0 flex items-center gap-1.5"
          >
            {suggesting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {suggesting ? 'Thinking…' : 'Suggest merges'}
          </button>
        </div>

        {suggestError && <p className="text-xs text-red-600 mt-2">{suggestError}</p>}

        {groups && groups.length === 0 && !suggesting && (
          <p className="text-sm text-gray-400 mt-3">No likely duplicates found.</p>
        )}

        {groups && groups.length > 0 && (
          <div className="space-y-3 mt-4">
            {groups.map((g, idx) => (
              <div key={idx} className="border border-gray-200 rounded-lg p-3">
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {g.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{t}</span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">→</span>
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
                    className="text-gray-400 hover:text-gray-600 shrink-0"
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

      {/* Every custom tag, manual rename/delete */}
      <div className="card p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">All custom tags ({customTags.length})</p>
        {customTags.length === 0 ? (
          <p className="text-sm text-gray-400">No custom tags yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {customTags.map(s => (
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
                    <button type="button" onClick={() => setRenaming(null)} className="text-gray-400 hover:text-gray-600">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <span className="text-sm text-gray-800">{s.tag}</span>
                      <span className="text-xs text-gray-400 ml-2">
                        {s.count} customer{s.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => startRename(s.tag)} className="text-gray-400 hover:text-gray-600" title="Rename everywhere">
                        <Pencil size={14} />
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(s.tag)} className="text-gray-400 hover:text-red-600" title="Delete everywhere">
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

      {picklistTags.length > 0 && (
        <div className="card p-5 mt-6">
          <p className="text-sm font-semibold text-gray-700 mb-1">Picklist tags in use</p>
          <p className="text-xs text-gray-400 mb-3">
            From the fixed Industry / Client Type / Order Profile / Geography groups — edit the picklist itself in
            CustomerForm.jsx to change these, not here.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {picklistTags.map(s => (
              <span key={s.tag} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                {s.tag} <span className="text-gray-400">· {s.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete}" from every customer that has it (${customTags.find(s => s.tag === confirmDelete)?.count || 0})? This can't be undone.`}
          confirmLabel="Delete everywhere"
          onConfirm={() => commitDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
