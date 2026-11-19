// These release checks run with exactly one buyer in a fresh browser context.
export function readQaBuyerDraft(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('cc_cart:'))
    if (keys.length > 1) throw Error('Expected an isolated, single-buyer QA context.')
    return keys.length ? JSON.parse(localStorage.getItem(keys[0])) : []
  })
}
