import { useState, useEffect } from 'react'
import { youtubeId } from '../constants'

// A hardcoded 16:9 box was forcing every video — including vertical YouTube
// Shorts — into a landscape iframe frame. YouTube's own player doesn't
// centre a portrait video inside a too-wide frame, it renders it pinned to
// one side with dead black space filling the rest (reported live,
// 2026-08-21). Fixed by sizing the box to the video's REAL aspect ratio
// instead of assuming landscape.
//
// A `/shorts/` URL is a free, instant signal (no request needed) that a
// video is portrait, used as the initial guess so a Shorts link never
// flashes landscape-then-corrects. Everything else — including a portrait
// video someone linked via a plain /watch?v= url — is resolved properly via
// YouTube's public oEmbed endpoint, which returns the real width/height for
// any video id, no API key required.
const isLikelyShort = url => /\/shorts\//i.test(url || '')

// Landscape videos fill the available width like before; a portrait video
// is capped to a sensible column width and centred (mx-auto) rather than
// stretched edge-to-edge at some absurd height.
const MAX_PORTRAIT_WIDTH = 360

// Lazy YouTube embed (facade pattern). Until the user clicks play we show only a
// lightweight thumbnail + play button — the heavy YouTube iframe (which pulls in
// ~1-2MB of player JS) is mounted ONLY after the click. Renders nothing when
// `url` isn't a valid YouTube link, so callers can drop it in unconditionally.
export default function VideoEmbed({ url, title = 'Product video', className = '' }) {
  const id = youtubeId(url)
  const [playing, setPlaying] = useState(false)
  // height/width fraction — 9/16 = landscape default, 16/9 = portrait guess
  // for a /shorts/ url. Corrected once oEmbed responds, for every video.
  const [ratio, setRatio] = useState(() => (isLikelyShort(url) ? 16 / 9 : 9 / 16))

  useEffect(() => {
    if (!id) return
    let alive = true
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!alive || !data?.width || !data?.height) return
        setRatio(data.height / data.width)
      })
      .catch(() => {}) // oEmbed unreachable — keep the URL-based guess
    return () => { alive = false }
  }, [id])

  if (!id) return null
  const isPortrait = ratio > 1

  return (
    <div className={className}>
      <div
        className="relative overflow-hidden rounded-lg bg-black"
        style={{
          paddingBottom: `${ratio * 100}%`,
          width: isPortrait ? `min(100%, ${MAX_PORTRAIT_WIDTH}px)` : '100%',
          marginInline: isPortrait ? 'auto' : undefined,
        }}
      >
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
