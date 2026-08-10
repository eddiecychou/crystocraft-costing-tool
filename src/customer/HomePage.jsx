import { Link } from 'react-router-dom'
import { Heart, ClipboardList, Receipt, Images, ArrowRight } from 'lucide-react'
import heroImage from '../assets/customer/hero-corporate.jpg'
import pillarFigurine from '../assets/customer/pillar-figurine.jpg'
import pillarCorporate from '../assets/customer/pillar-corporate.jpg'
import pillarCrystal from '../assets/customer/pillar-crystal.jpg'
import { heroContent, pillarsSection, pillars, quickAccessSection, quickActions } from './homepageContent'

const ICONS = { Heart, ClipboardList, Receipt, Images }
const PILLAR_IMAGE = { figurine: pillarFigurine, corporate: pillarCorporate, crystal: pillarCrystal }

function PillarCard({ pillar, spanFull }) {
  return (
    <Link to={pillar.to}
      className={`card overflow-hidden flex flex-col hover:shadow-md transition-shadow group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${spanFull ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
      <div className="aspect-[4/3] bg-ivory-dark overflow-hidden">
        <img src={PILLAR_IMAGE[pillar.key]} alt="" className="w-full h-full object-cover" loading="lazy" />
      </div>
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <h3 className="text-lg text-ink">{pillar.title}</h3>
        <p className="text-sm text-ink-60 leading-snug">{pillar.description}</p>
        <p className="text-[11px] text-ink-50 uppercase tracking-wide font-label">{pillar.metadata}</p>
        <div className="mt-auto pt-3 flex items-center gap-1.5 text-sm text-brand-600 font-medium group-hover:gap-2.5 transition-all">
          {pillar.ctaLabel} <ArrowRight size={15} />
        </div>
      </div>
    </Link>
  )
}

function QuickActionTile({ action }) {
  const Icon = ICONS[action.iconKey]
  return (
    <Link to={action.to}
      className="card flex flex-col items-center justify-center gap-2 py-5 px-3 text-center hover:shadow-md hover:border-brand-200 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
      <Icon size={22} strokeWidth={1.5} className="text-brand-600" />
      <span className="text-sm text-ink">{action.label}</span>
    </Link>
  )
}

export default function HomePage({ profile }) {
  const visibleQuickActions = quickActions.filter(a => !a.requiresCustomer || profile?.customer_id)

  const scrollToPillars = () => document.getElementById('pillars')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div>
      {/* Hero */}
      <section className="grid md:grid-cols-2 gap-8 items-center py-4 md:py-8">
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-50 font-label mb-2">
            {profile?.company_name ? `Welcome back, ${profile.company_name}` : 'Welcome back'}
          </p>
          <h1 className="text-2xl md:text-4xl text-ink leading-tight mb-3">{heroContent.heading}</h1>
          <p className="text-sm md:text-base text-ink-60 leading-relaxed mb-6 max-w-md">{heroContent.supporting}</p>
          <button onClick={scrollToPillars} className="btn-primary w-full sm:w-auto">{heroContent.primaryCta.label}</button>
        </div>
        <div className="aspect-[4/3] md:aspect-[3/2] rounded-lg overflow-hidden bg-ivory-dark">
          <img src={heroImage} alt="" className="w-full h-full object-cover" />
        </div>
      </section>

      {/* Pillars */}
      <section id="pillars" className="py-8 md:py-10 scroll-mt-4">
        <h2 className="text-xl md:text-2xl text-ink mb-1.5">{pillarsSection.heading}</h2>
        <p className="text-sm text-ink-60 mb-6 max-w-2xl">{pillarsSection.supporting}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {pillars.map((p, i) => (
            <PillarCard key={p.key} pillar={p} spanFull={i === pillars.length - 1} />
          ))}
        </div>
      </section>

      {/* Quick access */}
      <section className="py-6 md:py-8 border-t border-ivory-dark">
        <h2 className="text-lg md:text-xl text-ink mb-4">{quickAccessSection.heading}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {visibleQuickActions.map(a => <QuickActionTile key={a.key} action={a} />)}
        </div>
      </section>
    </div>
  )
}
