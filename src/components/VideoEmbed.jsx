import { youtubeEmbed } from '../constants'

// Responsive 16:9 YouTube embed. Renders nothing when `url` isn't a valid
// YouTube link, so callers can drop it in unconditionally.
export default function VideoEmbed({ url, title = 'Product video', className = '' }) {
  const embed = youtubeEmbed(url)
  if (!embed) return null
  return (
    <div className={className}>
      <div className="relative w-full overflow-hidden rounded-lg" style={{ paddingBottom: '56.25%' }}>
        <iframe
          src={embed}
          title={title}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
        />
      </div>
    </div>
  )
}
