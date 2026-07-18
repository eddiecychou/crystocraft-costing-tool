import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { AlertTriangle, Banknote, CheckCircle2, Search } from 'lucide-react'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'

// One-off audit: bank/remittance details are currently retyped or pasted into
// free-text fields on quotes and orders, so every document holds its own copy
// and nothing reconciles them. This finds the copies, groups them, and flags
// near-duplicates — a variant that differs from a much more common one by a
// character or two is the shape a typo takes.
//
// Read-only. Nothing here writes. Intended to seed a proper bank_accounts
// table, after which this page can go.

// Collections worth scanning, with the field used to label a hit.
const SOURCES = [
  { name: 'client_quotes',   label: 'Quote',    ref: (d) => d.quote_no || d.quote_ref || d.id },
  { name: 'orders',          label: 'Order',    ref: (d) => d.uc_no || d.erp_pi_no || d.erp_so_no || d.id },
  { name: 'purchase_orders', label: 'PO',       ref: (d) => d.po_no || d.id },
  { name: 'customers',       label: 'Customer', ref: (d) => d.name || d.id },
  { name: 'suppliers',       label: 'Supplier', ref: (d) => d.name || d.id },
]

const BANK_HINT = /(bank|a\/c|acc(ount)?\b|swift|iban|beneficiary|remit|payee)/i

// Extraction is LABEL-ANCHORED, not shape-based. Shape alone is far too loose:
// the bare BIC pattern /[A-Z]{6}[A-Z0-9]{2}/ matches HONGKONG, SHANGHAI,
// DEUTSCHE and CRYSTOCRAFT, and a bare digit-group pattern matches phone
// numbers and dates. Requiring the field's own label ("SWIFT:", "A/C") removed
// every false positive when tested against realistic PI terms.
const LABELLED = [
  { kind: 'IBAN', re: /\bIBAN\b[^A-Z0-9]{0,12}([A-Z]{2}\d{2}[A-Z0-9]{10,30})/gi },
  { kind: 'SWIFT', re: /\b(?:SWIFT|BIC)(?:\s*CODE)?\b[^A-Z0-9]{0,12}([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi },
  { kind: 'Account', re: /\b(?:A\/C|ACCOUNT|ACCT?|ACC)\.?\s*(?:NO\.?|NUMBER|#)?[^0-9]{0,8}(\d[\d\s-]{5,}\d)/gi },
]

// If the text just before the number is a phone/date/reference label, it isn't
// an account number however close the wording sits.
const NEG_CONTEXT = /(tel|phone|fax|mobile|whatsapp|date|dated|qty|invoice\s*no|po\s*no)\D{0,8}$/i

const digitsOf = (s) => s.replace(/\D/g, '')

// IBAN mod-97 (ISO 13616). Real validation: a transposed or mistyped digit
// fails it. Returns true/false, or null if the value isn't IBAN-shaped.
// Iterative remainder — the expanded number far exceeds Number's safe range.
function ibanValid(value) {
  const v = value.toUpperCase().replace(/\s/g, '')
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return null
  const rearranged = v.slice(4) + v.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const part = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of part) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

// Levenshtein, capped — we only care about "differs by 1-2".
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) m[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1, m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return m[a.length][b.length]
}

// Walk every string in a document, whatever the field is called — bank text
// has ended up in `notes`, but there's no guarantee that's the only place.
function* strings(value, path = '') {
  if (typeof value === 'string') { yield [path, value]; return }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* strings(value[i], `${path}[${i}]`)
    return
  }
  if (value && typeof value === 'object' && !value.toDate) {
    for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k)
  }
}

function extract(text) {
  const out = []
  for (const { kind, re } of LABELLED) {
    for (const m of text.matchAll(re)) {
      const raw = m[1].trim()
      if (kind === 'Account') {
        if (digitsOf(raw).length < 7) continue
        // m.index points at the label; check what precedes the number itself.
        if (NEG_CONTEXT.test(text.slice(0, m.index))) continue
      }
      out.push({
        kind,
        raw,
        key: kind === 'Account' ? digitsOf(raw) : raw.toUpperCase(),
        checksum: kind === 'IBAN' ? ibanValid(raw) : null,
      })
    }
  }
  return out
}

export default function BankDetailsAudit() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tokens, setTokens] = useState([])
  const [blocks, setBlocks] = useState([])
  const [scanned, setScanned] = useState({})

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const byToken = new Map()   // key -> { kind, variants:Map(raw->n), hits:[] }
        const byBlock = new Map()   // normalised bank line -> { text, hits:[] }
        const counts = {}

        for (const src of SOURCES) {
          let snap
          try {
            snap = await getDocs(collection(db, src.name))
          } catch (e) {
            // A collection the rules don't expose shouldn't kill the whole audit.
            console.error(`scan ${src.name} failed`, e)
            counts[src.name] = 'no access'
            continue
          }
          counts[src.name] = snap.size

          for (const docSnap of snap.docs) {
            const data = docSnap.data()
            const ref = `${src.label} ${src.ref(data)}`

            for (const [field, text] of strings(data)) {
              if (!text || text.length < 6 || !BANK_HINT.test(text)) continue

              // Keep the lines that actually mention banking, for context.
              for (const line of text.split(/\r?\n/)) {
                const t = line.trim()
                if (!t || !BANK_HINT.test(t)) continue
                const norm = t.replace(/\s+/g, ' ').toUpperCase()
                if (!byBlock.has(norm)) byBlock.set(norm, { text: t, hits: [] })
                byBlock.get(norm).hits.push(ref)
              }

              for (const tok of extract(text)) {
                if (!byToken.has(tok.key)) {
                  byToken.set(tok.key, { kind: tok.kind, key: tok.key, variants: new Map(), hits: [] })
                }
                const e = byToken.get(tok.key)
                e.variants.set(tok.raw, (e.variants.get(tok.raw) || 0) + 1)
                e.hits.push({ ref, field })
                if (tok.checksum === false) e.badChecksum = true
              }
            }
          }
        }

        // Flag near-duplicates: a rare token within 1-2 edits of a common one.
        const list = [...byToken.values()].sort((a, b) => b.hits.length - a.hits.length)
        for (const t of list) {
          t.suspect = null
          if (t.hits.length > 2) continue
          for (const other of list) {
            if (other === t || other.kind !== t.kind) continue
            if (other.hits.length < t.hits.length * 3 || other.hits.length < 3) continue
            const d = editDistance(t.key, other.key)
            if (d > 0 && d <= 2) { t.suspect = { other, d }; break }
          }
        }

        if (!alive) return
        setTokens(list)
        setBlocks([...byBlock.values()].sort((a, b) => b.hits.length - a.hits.length))
        setScanned(counts)
      } catch (e) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const flagged = tokens.filter((t) => t.suspect)
  // A failed IBAN check isn't a guess — the number is arithmetically wrong.
  const badChecksums = tokens.filter((t) => t.badChecksum)

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Banknote size={22} className="text-teal-600" /> Bank Details Audit
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Read-only. Finds bank/account numbers pasted into free-text fields across quotes,
          orders, POs, customers and suppliers, and flags variants that look like typos.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {!loading && (
        <p className="text-xs text-gray-400 mb-4">
          Scanned:{' '}
          {SOURCES.map((s) => `${s.name} (${scanned[s.name] ?? 0})`).join(' · ')}
        </p>
      )}

      {/* Definitely wrong: IBAN mod-97 failed. Not a heuristic. */}
      {!loading && badChecksums.length > 0 && (
        <div className="rounded-lg border bg-red-50 border-red-200 px-4 py-3 mb-4">
          <div className="flex items-center gap-2 text-red-900 font-semibold text-sm mb-2">
            <AlertTriangle size={16} />
            {badChecksums.length} IBAN{badChecksums.length === 1 ? '' : 's'} fail the checksum — these are wrong
          </div>
          <ul className="space-y-1 text-sm text-red-900">
            {badChecksums.map((t) => (
              <li key={t.key}>
                <span className="font-mono">{[...t.variants.keys()][0]}</span>
                <span className="text-xs text-red-700"> — in {t.hits.map((h) => h.ref).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suspected typos first — this is the question being asked. */}
      {!loading && (
        <div className={`rounded-lg border px-4 py-3 mb-6 ${
          flagged.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
        }`}>
          {flagged.length ? (
            <>
              <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm mb-2">
                <AlertTriangle size={16} />
                {flagged.length} value{flagged.length === 1 ? '' : 's'} look like a typo
              </div>
              <ul className="space-y-2 text-sm">
                {flagged.map((t) => (
                  <li key={t.key} className="text-amber-900">
                    <span className="font-mono">{[...t.variants.keys()][0]}</span>
                    {' '}({t.hits.length}×) differs by {t.suspect.d} character
                    {t.suspect.d === 1 ? '' : 's'} from{' '}
                    <span className="font-mono">{[...t.suspect.other.variants.keys()][0]}</span>
                    {' '}({t.suspect.other.hits.length}×)
                    <div className="text-xs text-amber-700 mt-0.5">
                      in {t.hits.map((h) => h.ref).join(', ')}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex items-center gap-2 text-green-800 text-sm">
              <CheckCircle2 size={16} /> No near-duplicate account numbers found.
            </div>
          )}
        </div>
      )}

      {/* Every distinct token */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">All values found</h2>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium text-right">Uses</th>
                <th className="px-3 py-2 font-medium">Written as</th>
                <th className="px-3 py-2 font-medium">Appears in</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.key} className={`border-b border-gray-100 last:border-0 ${t.suspect ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{t.kind}</td>
                  <td className="px-3 py-2 font-mono text-xs">{[...t.variants.keys()][0]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.hits.length}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {t.variants.size > 1
                      ? `${t.variants.size} formats: ${[...t.variants.keys()].join(' / ')}`
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {t.hits.slice(0, 4).map((h) => h.ref).join(', ')}
                    {t.hits.length > 4 ? ` +${t.hits.length - 4} more` : ''}
                  </td>
                </tr>
              ))}
              {!loading && !tokens.length && (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-400">
                  No bank-like values found in any scanned field.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw lines, for reading what the documents actually say */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
        <Search size={14} /> Bank-related lines, most common first
      </h2>
      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {blocks.slice(0, 60).map((b, i) => (
          <div key={i} className="px-3 py-2 text-sm flex gap-3">
            <span className="text-gray-400 tabular-nums text-xs w-10 shrink-0">{b.hits.length}×</span>
            <span className="font-mono text-xs break-words min-w-0">{b.text}</span>
          </div>
        ))}
        {!loading && !blocks.length && (
          <div className="px-3 py-10 text-center text-gray-400">Nothing found.</div>
        )}
      </div>
    </div>
  )
}
