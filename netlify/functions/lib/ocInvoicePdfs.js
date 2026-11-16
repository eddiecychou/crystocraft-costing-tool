import { createHash } from 'node:crypto'
import { customerFileAttachmentHeader } from '../../../src/customerFilesModel.js'
import { OC_PDF_AVAILABLE, OC_PDF_MISSING, OC_PDF_RETRY, OC_PDF_REVIEW } from '../../../src/ocInvoicePdfStatus.js'
import { privateHeaders, privateJson } from './customerAccess.js'

const catalogue = 'oc_invoice_originals'
const maxPdfBytes = 4 * 1024 * 1024
const validDigest = /^[0-9a-f]{64}$/

export function ocInvoicePdfStatus(entry, record, issuer) {
  if (!record || ['staged', 'withdrawn'].includes(record.status)) return OC_PDF_MISSING
  const { row, recordKey, payable } = entry
  if (record.status !== 'approved' || record.source !== row.source || record.issuer !== issuer ||
      record.invoiceNo !== row.no || record.recordKey !== recordKey || !row.date || !row.customer || !row.currency ||
      row.amount === null || row.date !== record.date || row.customer !== record.customer || row.currency !== record.currency ||
      row.amount !== record.amount || payable !== record.payable ||
      typeof record.reviewedBy !== 'string' || !record.reviewedBy.trim() ||
      typeof record.reviewedAt !== 'string' || !Number.isFinite(Date.parse(record.reviewedAt)) ||
      typeof record.provenance !== 'string' || !record.provenance.trim() ||
      typeof record.filename !== 'string' || !/^[^/\\\x00-\x1f\x7f]{1,180}\.pdf$/i.test(record.filename) ||
      !Number.isSafeInteger(record.byteSize) || record.byteSize < 5 || record.byteSize > maxPdfBytes ||
      typeof record.sha256 !== 'string' || !validDigest.test(record.sha256) || typeof record.generation !== 'string' ||
      !/^[1-9]\d*$/.test(record.generation) || !Number.isSafeInteger(Number(record.generation))) return OC_PDF_REVIEW
  return OC_PDF_AVAILABLE
}

function pdfUnavailable(status) {
  return privateJson({ error: status }, status === OC_PDF_MISSING ? 404 : status === OC_PDF_REVIEW ? 409 : 503)
}

const version = record => `"${record.generation}-${record.sha256}"`
const approvalVersion = record => JSON.stringify([version(record), record.reviewedAt, record.reviewedBy, record.filename, record.provenance])

export async function readOcInvoicePdf({ entry, archive, authorize, ifMatch }) {
  if (!entry || !archive) return pdfUnavailable(OC_PDF_MISSING)
  try {
    const record = await archive.get(entry.row.no)
    const status = ocInvoicePdfStatus(entry, record, archive.issuer)
    if (status !== OC_PDF_AVAILABLE) return pdfUnavailable(status)
    if (ifMatch && ifMatch !== version(record)) return pdfUnavailable(OC_PDF_REVIEW)
    const bytes = await archive.read(record)
    if (!bytes) return pdfUnavailable(OC_PDF_MISSING)
    if (bytes.length !== record.byteSize || bytes.subarray(0, 5).toString() !== '%PDF-' ||
        createHash('sha256').update(bytes).digest('hex') !== record.sha256) return pdfUnavailable(OC_PDF_REVIEW)

    const [latest, allowed] = await Promise.all([archive.get(entry.row.no), authorize()])
    if (!allowed) return privateJson({ error: 'Access denied' }, 403)
    const latestStatus = ocInvoicePdfStatus(entry, latest, archive.issuer)
    if (latestStatus !== OC_PDF_AVAILABLE) return pdfUnavailable(latestStatus)
    if (approvalVersion(latest) !== approvalVersion(record)) return pdfUnavailable(OC_PDF_REVIEW)
    return new Response(bytes, { headers: { ...privateHeaders, 'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length), 'Content-Disposition': customerFileAttachmentHeader(record.filename),
      'Cross-Origin-Resource-Policy': 'same-origin', ETag: version(record) } })
  } catch {
    return pdfUnavailable(OC_PDF_RETRY)
  }
}

export function createOcInvoicePdfArchive(db, getBucket, issuer) {
  const records = db.collection(catalogue)
  return {
    issuer,
    get: async no => (await records.doc(no).get()).data(),
    list: async () => new Map((await records.get()).docs.map(doc => [doc.id, doc.data()])),
    read: async record => {
      // The approved SI and digest determine the path. The request supplies neither a path nor a file URL.
      const file = getBucket().file(`oc-invoice-originals/${record.invoiceNo}/${record.sha256}.pdf`, { generation: record.generation })
      try {
        const [meta] = await file.getMetadata()
        if (String(meta.generation) !== record.generation || Number(meta.size) !== record.byteSize ||
            meta.contentType !== 'application/pdf' || meta.contentEncoding || meta.metadata?.firebaseStorageDownloadTokens) {
          // Any invalid bytes fail the integrity check without reading the object.
          return Buffer.alloc(0)
        }
        return (await file.download({ validation: 'crc32c' }))[0]
      } catch (error) {
        if (Number(error.code) === 404) return null
        throw error
      }
    },
  }
}
