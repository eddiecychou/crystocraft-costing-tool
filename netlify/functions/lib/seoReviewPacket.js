function text(value, max, label, { optional = false } = {}) {
  if (optional && value == null) return ''
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) {
    throw new Error('Invalid review ' + label)
  }
  return value
}

// Review notes and image thumbnails are independent of the WordPress payload.
export function readReviewPacket(value) {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || !Array.isArray(value.copy) || value.copy.length < 1
    || value.copy.length > 3 || !Array.isArray(value.photos) || value.photos.length > 16) {
    throw new Error('Review packet needs copy sections and an image list')
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 280_000) throw new Error('Review packet exceeds 280 KB')

  const copy = value.copy.map(section => {
    if (!section || !Array.isArray(section.fields) || section.fields.length < 1 || section.fields.length > 20) {
      throw new Error('Invalid review copy fields')
    }
    return {
      label: text(section.label, 120, 'language or editor'),
      instructions: text(section.instructions, 600, 'instructions', { optional: true }),
      fields: section.fields.map(field => ({
        label: text(field?.label, 120, 'field name'),
        before: text(field?.before, 8_000, 'before value', { optional: true }),
        after: text(field?.after, 8_000, 'after value'),
      })),
    }
  })

  const photos = value.photos.map(photo => {
    const thumbnail = text(photo?.thumbnail, 36_000, 'thumbnail')
    if (!/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(thumbnail)) {
      throw new Error('Review thumbnails must be inline WebP images')
    }
    const bytes = Buffer.from(thumbnail.slice('data:image/webp;base64,'.length), 'base64')
    if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
      throw new Error('Invalid WebP review thumbnail')
    }
    const reference = text(photo.reference, 180, 'photo reference')
    return {
      title: text(photo.title, 120, 'photo title'),
      placement: text(photo.placement, 160, 'photo placement'),
      alt_en: text(photo.alt_en, 280, 'English alt text'),
      alt_zh_hant: text(photo.alt_zh_hant, 280, 'Traditional Chinese alt text'),
      thumbnail,
      reference,
    }
  })
  return { copy, photos }
}
