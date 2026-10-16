// Client contains no Admin SDK, service-account key or custom-token minting path.
import { readFile, stat, writeFile } from 'node:fs/promises'
let cached
export async function getRangeUploadToken({ fetchImpl = fetch, now = Date.now } = {}) {
  if (cached && cached.expires > now()) return cached.token
  const path = process.env.OC_RANGE_REFRESH_TOKEN_FILE, apiKey = process.env.OC_FIREBASE_API_KEY
  if (!path || !apiKey) throw new Error('Configure the separate Range identity token file and public Firebase API key; never copy an Admin key into this client')
  const info = await stat(path)
  if (!info.isFile() || (info.mode & 0o077)) throw new Error('Range token file must be a private owner-only file (0600)')
  const refreshToken = (await readFile(path, 'utf8')).trim()
  if (!refreshToken || refreshToken.length > 10000) throw new Error('Invalid scoped Range credential file')
  const r = await fetchImpl(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data.id_token) throw new Error('Scoped Range sign-in expired or revoked; ask the operator to refresh this identity')
  if (data.refresh_token && data.refresh_token !== refreshToken) await writeFile(path, data.refresh_token + '\n', { mode: 0o600 })
  cached = { token: data.id_token, expires: now() + Math.max(0, Number(data.expires_in || 3600) - 120) * 1000 }
  return cached.token
}
