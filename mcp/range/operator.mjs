// Human-only approval client. Never registered as an MCP tool. No Admin secret.
import { readFile } from 'node:fs/promises'
const args = process.argv.slice(2)
const file = args[0]
if (!file) throw new Error('Usage: node operator.mjs preview.json [--approve] [--allow-public-update]. Defaults to review only.')
const preview = JSON.parse(await readFile(file, 'utf8'))
if (!preview.safe_to_commit || !preview.preview_token || !preview.preview_hash) throw new Error('A valid exact dry-run result is required')
console.log(JSON.stringify({ reviewed_hash: preview.preview_hash, expires_at: preview.expires_at, proposed: preview.proposed, diff: preview.diff, new_components: preview.new_components, warnings: preview.warnings }, null, 2))
if (args.includes('--approve')) {
  if (process.env.OC_REVIEWED_PREVIEW_HASH !== preview.preview_hash || !process.env.OC_OPERATOR_ID_TOKEN || !process.env.OC_APPROVAL_PURPOSE) throw new Error('Set the exact separately reviewed hash, current admin ID token and purpose; no approval was sent')
  const base = new URL(process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname))) || base.username || base.password) throw new Error('HTTPS required')
  const r = await fetch(new URL('/api/mcp-range', base), { method: 'POST', headers: { Authorization: `Bearer ${process.env.OC_OPERATOR_ID_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'approve_range_upload', input: { preview_token: preview.preview_token, expected_preview_hash: preview.preview_hash, purpose: process.env.OC_APPROVAL_PURPOSE, allow_public_update: args.includes('--allow-public-update') } }) })
  const data = await r.json()
  if (!r.ok) throw new Error(`${data.error?.code}: ${data.error?.message}`)
  console.log(JSON.stringify(data))
}
