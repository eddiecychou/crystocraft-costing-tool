import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useComponents } from '../criticalComponents'
import { useCrystals } from '../crystals'
import { usePackaging } from '../packaging'
import { useB2cStock } from '../b2cStock'
import { Package, Puzzle, Factory, Boxes, AlertTriangle } from 'lucide-react'
import { useT } from '../i18n'

// Production-role landing page (V8.12 RBAC). The real Dashboard is built
// entirely on customers/quotes/orders/enquiries — sales data a production
// login must never see, and which the Phase 2 Firestore rules will refuse to
// serve it anyway (its onSnapshots would error). So factory staff get their
// OWN dashboard, reading only the supply-side collections their role can
// access: the four inventory classes, surfaced as a low-stock summary plus
// quick links into the modules they're allowed. Deliberately small — "basic
// Dashboard stats" per the brief, not a second inventory screen.

// Same reorder test InventoryStatus uses: below the reorder point if one is
// set, otherwise only when over-committed (available negative).
const needsReorder = r => (r.reorder_point > 0 ? r.available <= r.reorder_point : r.available < 0)

// Normalise one inventory class into { available, reorder_point } the same
// way InventoryStatus does — same field names (stock_qty / reserved_qty), so
// the low-stock count here matches that screen exactly.
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const avail = c => (num(c.stock_qty) - num(c.reserved_qty))

function lowStock(arr) {
  return (arr || [])
    .map(c => ({ ...c, available: avail(c), reorder_point: num(c.reorder_point) }))
    .filter(needsReorder)
}

function StatCard({ Icon, label, value, tone = 'ink' }) {
  const toneCls = tone === 'warn' ? 'text-amber-600' : 'text-ink'
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-ink-60 mb-2">
        <Icon size={16} strokeWidth={1.75} />
        <span className="text-2xs uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-3xl font-semibold ${toneCls}`}>{value}</p>
    </div>
  )
}

const LINKS = [
  { to: '/products',   label: 'Corp Gifts',  Icon: Package },
  { to: '/components', label: 'Components',  Icon: Puzzle },
  { to: '/suppliers',  label: 'Suppliers',   Icon: Factory },
  { to: '/inventory',  label: 'Inventory',   Icon: Boxes },
]

export default function ProductionDashboard() {
  const t = useT()
  const { components } = useComponents()
  const { items: crystals } = useCrystals()
  const { items: packaging } = usePackaging()
  const { items: b2c } = useB2cStock()

  const low = useMemo(
    () => [
      ...lowStock(components).map(r => ({ ...r, cls: 'Metal' })),
      ...lowStock(crystals).map(r => ({ ...r, cls: 'Crystal' })),
      ...lowStock(packaging).map(r => ({ ...r, cls: 'Packaging' })),
      ...lowStock(b2c).map(r => ({ ...r, cls: 'Finished Goods' })),
    ].sort((a, b) => a.available - b.available),
    [components, crystals, packaging, b2c],
  )

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <h1 className="text-xl mb-1">{t('Production')}</h1>
      <p className="text-sm text-ink-60 mb-6">{t('Supply-side overview. Catalogue, components, suppliers and stock.')}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard Icon={Puzzle} label={t('Metal components')} value={(components || []).length} />
        <StatCard Icon={Boxes} label={t('Crystal SKUs')} value={(crystals || []).length} />
        <StatCard Icon={Boxes} label={t('Packaging SKUs')} value={(packaging || []).length} />
        <StatCard Icon={AlertTriangle} label={t('Low stock')} value={low.length} tone={low.length ? 'warn' : 'ink'} />
      </div>

      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm text-ink-80">{t('Reorder alerts')}</h2>
          <Link to="/inventory" className="text-xs text-brand-600 hover:underline">{t('Open Inventory →')}</Link>
        </div>
        {low.length === 0 ? (
          <p className="text-sm text-ink-60">{t('Nothing below its reorder point.')}</p>
        ) : (
          <div className="divide-y divide-warm-grey">
            {low.slice(0, 12).map((r, i) => (
              <div key={`${r.cls}-${r.id || i}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-70 truncate">
                  <span className="text-2xs px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 uppercase tracking-wide mr-2">{t(r.cls)}</span>
                  {r.code || r.name || r.id}
                </span>
                <span className={`shrink-0 ${r.available < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                  {t('{n} avail', { n: r.available.toLocaleString() })}
                </span>
              </div>
            ))}
            {low.length > 12 && <p className="text-xs text-ink-60 pt-2">{t('…and {n} more.', { n: low.length - 12 })}</p>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {LINKS.map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="card p-4 flex flex-col items-center gap-2 hover:border-brand-300 transition-colors text-center">
            <Icon size={22} strokeWidth={1.6} className="text-ink-60" />
            <span className="text-sm text-ink-80">{t(label)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
