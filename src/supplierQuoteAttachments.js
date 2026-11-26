import { runTransaction } from 'firebase/firestore'
import { sameFirestoreValue } from './firestoreValue'
import { db } from './firebase'

const MAX_IMAGE_EDGE = 2400
const PDF_TYPE = 'application/pdf'

export async function prepareSupplierQuoteUpload(file) {
  if (file.type === PDF_TYPE) return { blob: file, contentType: PDF_TYPE, fileType: 'pdf' }

  const { canvas } = await drawQuoteImage(file)
  const contentType = 'image/jpeg'
  const blob = await canvas.convertToBlob({ type: contentType, quality: 0.93 })
  return { blob, contentType, fileType: 'image' }
}

export async function prepareSupplierQuoteExtraction(file) {
  const isPdf = file.type === PDF_TYPE
  const blob = isPdf ? file : await prepareQuoteScan(file)
  return { image: await readBase64(blob), mimeType: isPdf ? PDF_TYPE : 'image/png' }
}

async function drawQuoteImage(file) {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0, width, height)
    return { canvas, context }
  } finally {
    bitmap.close()
  }
}

async function prepareQuoteScan(file) {
  const { canvas, context } = await drawQuoteImage(file)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imageData.data

  for (let i = 0; i < pixels.length; i += 4) {
    const grey = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
    pixels[i] = pixels[i + 1] = pixels[i + 2] = grey
  }

  // Stretch contrast between the 1st and 99th percentiles for extraction.
  const greys = []
  for (let i = 0; i < pixels.length; i += 4) greys.push(pixels[i])
  greys.sort((a, b) => a - b)
  const low = greys[Math.floor(greys.length * 0.01)]
  const high = greys[Math.floor(greys.length * 0.99)]
  const spread = high - low || 1
  for (let i = 0; i < pixels.length; i += 4) {
    const level = Math.round((pixels[i] - low) / spread * 255)
    pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.max(0, Math.min(255, level))
  }

  context.putImageData(imageData, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function hasUnchangedQuoteTerms(original, form, tiers) {
  return original && sameFirestoreValue(form, original.form) && sameFirestoreValue(tiers, original.tiers)
}

export function saveQuoteAttachments(quoteRef, originalAttachments, attachments, { validateContext, isOpen, allowAlreadySaved }) {
  return runTransaction(db, async tx => {
    if (validateContext) await validateContext(ref => tx.get(ref))
    const latest = await tx.get(quoteRef)
    if (!isOpen()) throw new Error('This quote editor is no longer open. Reopen the quote before saving.')
    const current = latest.data()?.attachments || []
    if (latest.exists() && sameFirestoreValue(current, originalAttachments)) {
      tx.update(quoteRef, { attachments })
      return
    }
    if (allowAlreadySaved && latest.exists() && sameFirestoreValue(current, attachments)) return
    throw new Error('Attachments changed in another session. Reopen this quote before saving.')
  })
}
