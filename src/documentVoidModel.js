export const exactSalesInvoiceNo = value => typeof value === 'string' && value.length <= 64 && /^SI\d{6,}$/.test(value)

export function canonicalSalesInvoiceNo(value) {
  const number = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return exactSalesInvoiceNo(number) ? number : ''
}

export function piDocumentIdentity(order) {
  const no = typeof order?.erp_so_no === 'string' ? order.erp_so_no.trim() : ''
  const revision = order?.pi_revision ?? 0
  if (!no || no.length > 100 || /^SI/i.test(no) || order.source === 'direct_invoice' ||
      !Number.isSafeInteger(revision) || revision < 0) return null
  return { no, revision }
}
