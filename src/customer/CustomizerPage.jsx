import { useParams, Link } from 'react-router-dom'
import { useCustomerCatalogue } from '../hooks/useCustomerCatalogue'
import LoadingBar from '../components/LoadingBar'
import { engineTypeOf, engineDef, engineAvailable } from '../customizerEngines'
import CrystalFabricCustomizer from './customizer/CrystalFabricCustomizer'

// Dispatcher: loads the product, resolves which customization engine it maps to,
// and renders that engine's UI. Add a case here as new engines are built.
export default function CustomizerPage({ profile }) {
  const { productId } = useParams()
  const { data, loading, error, retry } = useCustomerCatalogue(profile, productId)
  const product = loading ? undefined : data?.products[0] || null
  if (error) return <p role="alert">{error} <button onClick={retry}>Retry</button></p>

  if (product === undefined) return <LoadingBar />
  if (product === null) return <NotAvailable msg="This product is no longer available." />

  const type = engineTypeOf(product)
  if (!type || !engineDef(type)) {
    return <NotAvailable product={product} msg="This product isn’t set up for customisation." />
  }
  if (!engineAvailable(type)) {
    return <NotAvailable product={product} msg={`${engineDef(type).label} customisation is coming soon.`} />
  }

  switch (type) {
    case 'crystal_fabric':
      return <CrystalFabricCustomizer product={product} profile={profile} />
    default:
      return <NotAvailable product={product} msg="This customisation type isn’t available yet." />
  }
}

function NotAvailable({ product, msg }) {
  const back = product ? `/shop/corporate/${product.id}` : '/shop/corporate'
  return (
    <div className="text-center py-20 text-ink-60">
      <p>{msg}</p>
      <Link to={back} className="text-brand-600 text-sm mt-2 inline-block">← Back to Corporate Gifts</Link>
    </div>
  )
}
