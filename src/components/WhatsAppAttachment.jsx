// Inline preview/playback for a WhatsApp thread attachment (V8.2 ingestion —
// domain/whatsappImport.js). Every attachment used to render as a bare
// "📎 filename" download link regardless of type, even though attachment_url
// is already a public Storage download URL the browser can render directly —
// found real 2026-08-18: images and voice notes are the two most common
// attachment types in these exports, and neither previewed or played inline.
// Shared by CustomerDetail.jsx's and MarketingContacts.jsx's WhatsApp cards
// (same message shape, same posture) so the type-sniffing logic lives once.
const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i
const AUDIO_RE = /\.(opus|mp3|m4a|aac|ogg|wav)$/i
const VIDEO_RE = /\.(mp4|mov|webm)$/i

export default function WhatsAppAttachment({ filename, url, className = '' }) {
  if (!filename) return null
  if (!url) return <span className={`text-ink-60 ${className}`}>📎 {filename} (file missing)</span>

  if (IMAGE_RE.test(filename)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={`block ${className}`}>
        <img src={url} alt={filename} className="max-h-40 max-w-[200px] rounded border border-warm-grey object-cover" />
      </a>
    )
  }
  if (AUDIO_RE.test(filename)) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- WhatsApp voice notes have no caption track
      <audio controls preload="none" src={url} className={`h-8 max-w-full ${className}`} />
    )
  }
  if (VIDEO_RE.test(filename)) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video controls preload="none" src={url} className={`max-h-48 max-w-[240px] rounded border border-warm-grey ${className}`} />
    )
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`text-brand-600 hover:underline ${className}`}>
      📎 {filename}
    </a>
  )
}
