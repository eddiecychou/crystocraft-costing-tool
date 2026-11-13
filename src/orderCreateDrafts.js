const key = (operator, id) => `oc-order-create:${encodeURIComponent(operator)}:${id}`

export function readOrderCreateDraft(operator, id) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key(operator, id)))
    return draft?.header && Array.isArray(draft.lines) ? draft : null
  } catch {
    return null
  }
}

export function saveOrderCreateDraft(operator, id, draft) {
  try {
    sessionStorage.setItem(key(operator, id), JSON.stringify(draft))
  } catch {
    // The request editor retains the draft in memory if storage is unavailable.
  }
}

export function removeOrderCreateDraft(operator, id) {
  try {
    sessionStorage.removeItem(key(operator, id))
  } catch {
    // The in-memory copy is cleared by the request editor.
  }
}

export function separateOrderDraft({ header, lines, original }) {
  return {
    header: {
      ...header,
      erp_so_no: '', erp_pi_no: '', erp_si_no: '', uc_no: '', pi_revision: '',
      invoiced_at: '', invoice_date: '', accounting_total: '', adjustment_reason: '',
    },
    lines,
    original,
  }
}
