import { Plus, X } from 'lucide-react'
import { youtubeEmbed } from '../constants'

// Repeatable list of YouTube URL inputs. `videos` is an array of strings;
// `onChange` receives the next array. Always renders at least one row.
export default function VideoUrlsEditor({ videos, onChange, label = 'Product Videos (YouTube)' }) {
  const list = videos && videos.length ? videos : ['']
  const update = (i, val) => { const next = [...list]; next[i] = val; onChange(next) }
  const add = () => onChange([...list, ''])
  const remove = i => { const next = list.filter((_, j) => j !== i); onChange(next.length ? next : ['']) }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="space-y-2">
        {list.map((v, i) => (
          <div key={i}>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                value={v}
                onChange={e => update(i, e.target.value)}
                placeholder="https://www.youtube.com/watch?v=… — shown to customers in the catalogue"
              />
              {(list.length > 1 || v) && (
                <button type="button" onClick={() => remove(i)} aria-label="Remove video"
                  className="shrink-0 p-2 text-ink-60 hover:text-red-500 transition-colors">
                  <X size={16} />
                </button>
              )}
            </div>
            {v && !youtubeEmbed(v) && (
              <p className="text-xs text-amber-600 mt-1">This doesn't look like a YouTube link — the video won't display.</p>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={add}
        className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 transition-colors">
        <Plus size={13} /> Add another video
      </button>
    </div>
  )
}
