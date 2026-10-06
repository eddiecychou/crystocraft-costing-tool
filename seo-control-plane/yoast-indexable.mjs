// Workbench-side WP-CLI adapter. runWpCli(args) must execute the argv array
// on the WordPress host, reject non-zero exits, and return stdout. Do not use
// shell interpolation or a database credential in the OC.
export async function deleteYoastIndexable({ id, endpoint, runWpCli }) {
  if (typeof runWpCli !== 'function') throw new Error('runWpCli is required')
  const postId = Number(id)
  if (!Number.isSafeInteger(postId) || postId <= 0) throw new Error('invalid WordPress post ID')
  const path = String(endpoint || '').split('?')[0]
  const kind = /\/products\/\d+$/.test(path) ? 'product'
    : /\/posts\/\d+$/.test(path) ? 'post'
      : /\/pages\/\d+$/.test(path) ? 'page' : null
  if (!kind) throw new Error('Yoast indexable deletion needs a specific post, page, or product endpoint')
  const prefix = String(await runWpCli(['db', 'prefix'])).trim()
  if (!/^[A-Za-z0-9_]+$/.test(prefix)) throw new Error('unsafe WordPress table prefix')
  const where = `object_id = ${postId} AND object_type = 'post' AND object_sub_type = '${kind}'`
  await runWpCli(['db', 'query', `DELETE FROM ${prefix}yoast_indexable WHERE ${where}`])
  const remaining = String(await runWpCli(['db', 'query',
    `SELECT COUNT(*) FROM ${prefix}yoast_indexable WHERE ${where}`, '--skip-column-names'])).trim()
  if (remaining !== '0') throw new Error(`Yoast indexable row still present for ${kind} ${postId}`)
  return true
}
