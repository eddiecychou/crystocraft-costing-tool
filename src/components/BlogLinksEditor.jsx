import { Plus, X } from 'lucide-react'

// Repeatable list of {label, url} rows — "Learn More" links shown to every
// customer on the product page (a blog post, a spec sheet, anything worth
// pointing them at). Same shape as VideoUrlsEditor.jsx, just two fields per
// row instead of one since a raw URL isn't friendly customer-facing copy.
export default function BlogLinksEditor({ links, onChange, label = 'Learn More Links' }) {
  const list = links && links.length ? links : [{ label: '', url: '' }]
  const update = (i, field, val) => {
    const next = [...list]
    next[i] = { ...next[i], [field]: val }
    onChange(next)
  }
  const add = () => onChange([...list, { label: '', url: '' }])
  const remove = i => {
    const next = list.filter((_, j) => j !== i)
    onChange(next.length ? next : [{ label: '', url: '' }])
  }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="space-y-2">
        {list.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="input w-2/5"
              value={l.label || ''}
              onChange={e => update(i, 'label', e.target.value)}
              placeholder="Link text, e.g. &quot;How it's made&quot;"
            />
            <input
              className="input flex-1"
              value={l.url || ''}
              onChange={e => update(i, 'url', e.target.value)}
              placeholder="https://www.crystocraft.com/blog/… — shown to every customer"
            />
            {(list.length > 1 || l.label || l.url) && (
              <button type="button" onClick={() => remove(i)} aria-label="Remove link"
                className="shrink-0 p-2 text-ink-60 hover:text-red-500 transition-colors">
                <X size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={add}
        className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 transition-colors">
        <Plus size={13} /> Add another link
      </button>
    </div>
  )
}
