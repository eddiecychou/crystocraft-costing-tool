import logo from '../assets/logo.png'
import coverFont from '../assets/fonts/Questrial-Regular.ttf'

// Shared by the editor preview and print/PDF page, so contrast choices match.
export const coverTextColor = catalogue => catalogue.cover_text_color === 'black' ? '#000000' : '#ffffff'

export default function CatalogueCover({ catalogue, compact = false }) {
  const ink = coverTextColor(catalogue)
  const Title = compact ? 'p' : 'h1'
  const hasBg = Boolean(catalogue.cover_image)
  return (
    <div className="catalogue-page cover-page" style={{
      position: 'relative', overflow: 'hidden', display: 'flex',
      alignItems: 'flex-end', justifyContent: 'flex-end', flexDirection: 'column',
      color: ink, background: hasBg ? 'none' : ink === '#000000' ? '#ffffff' : '#1a1a1a',
      ...(compact ? { width: '100%', height: '100%', margin: 0, boxShadow: 'none' } : {}),
    }}>
      <style>{`@font-face { font-family: 'Catalogue Cover Questrial'; src: url('${coverFont}') format('truetype'); font-display: swap; }`}</style>
      {hasBg && <img src={catalogue.cover_image} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {hasBg && <div className="cover-overlay" style={{
        position: 'absolute', inset: 0,
        background: catalogue.overlay_color === 'white' ? 'white' : 'black',
        opacity: catalogue.overlay_opacity ?? 0.45,
      }} />}
      <div className="cover-inner" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        gap: compact ? 6 : 12, zIndex: 1, maxWidth: '100%', boxSizing: 'border-box',
        padding: compact ? '16px' : '36px', textAlign: 'right', color: ink,
      }}>
        <img src={logo} alt="Crystocraft" className="cover-logo" style={{ height: compact ? 22 : 36, width: 'auto', filter: ink === '#ffffff' ? 'invert(1) brightness(2)' : 'none' }} />
        <div className="cover-divider" style={{ width: compact ? 32 : 48, height: 1, background: 'currentColor', margin: '2px 0', flexShrink: 0 }} />
        <Title className="cover-title" style={{ fontFamily: "'Catalogue Cover Questrial', sans-serif", fontSize: compact ? 14 : 28, fontWeight: 400, color: 'inherit', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, lineHeight: 1.15 }}>{catalogue.name || (compact ? 'Catalogue title' : '')}</Title>
        {catalogue.season && <p className="cover-season" style={{ fontSize: compact ? 8 : 12, color: 'inherit', letterSpacing: '0.25em', textTransform: 'uppercase', margin: 0 }}>{catalogue.season}</p>}
        {catalogue.tagline && <p className="cover-tagline" style={{ fontSize: compact ? 10 : 16, color: 'inherit', margin: '2px 0 0', fontStyle: 'italic' }}>{catalogue.tagline}</p>}
      </div>
    </div>
  )
}
