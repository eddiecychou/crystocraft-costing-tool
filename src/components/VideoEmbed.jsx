import { useState } from 'react'
import { youtubeId } from '../constants'

// Lazy YouTube embed (facade pattern). Until the user clicks play we show only a
// lightweight thumbnail + play button — the heavy YouTube iframe (which pulls in
// ~1-2MB of player JS) is mounted ONLY after the click. Renders nothing when
// `url` isn't a valid YouTube link, so callers can drop it in unconditionally.
export default function VideoEmbed({ url, title = 'Product video', className = '' }) {
  const id = youtubeId(url)
  const [playing, setPlaying] = useState(false)
  if (!id) return null

  return (
    <div className={className}>
      <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ paddingBottom: '56.25%' }}>
        {playing ? (
          <iframe
            src={`https://www.youtube.com/embed/${id}?autoplay=1`}
            title={title}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play ${title}`}
            className="absolute inset-0 w-full h-full group cursor-pointer"
          >
            <img
              src={`https://img.youtube.com/vi/${id}/hqdefault.jpg`}
              alt={title}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
              <span className="flex items-center justify-center w-16 h-11 rounded-xl bg-red-600 group-hover:bg-red-700 transition-colors shadow-lg">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="white" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
