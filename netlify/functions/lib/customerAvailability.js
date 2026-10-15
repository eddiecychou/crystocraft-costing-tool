import { productAvailability, buildableFromComponents, resolveRef, availabilityComponent } from '../../../src/availability.js'

const headers = { 'Content-Type':'application/json', 'Cache-Control':'private, no-store' }
const json = (data,status=200) => new Response(JSON.stringify(data), {status,headers})
const finite = n => Number.isFinite(n) && n >= 0 ? n : null
const quantities = values => Object.fromEntries(Object.entries(values || {}).map(([k,v])=>[k,finite(v)]))

// Explicit projection: no component object, supplier, price, bottleneck or part code.
export function projectAvailability(product, components, defaults, now = () => new Date()) {
  components = components.map(c=>({id:c.id,...availabilityComponent(c)}))
  const refs = Array.isArray(product.critical_components) ? product.critical_components : []
  if (refs.some(ref => !resolveRef(ref, components))) return {
    verified:false, buildable:null, finished:null, byPlating:{}, byVariant:{}, leadWeeks:null,
    customerPromise:'Availability and lead time need confirmation. Please contact us.', checkedAt:now().toISOString(),
  }
  const av = productAvailability(product, components, defaults)
  const summary = p => {
    const value = productAvailability(p, components, defaults)
    return { buildable:finite(value.buildable), leadWeeks:finite(value.leadWeeks), customerPromise:value.customerPromise }
  }
  const variants = Array.isArray(product.variants) ? product.variants : []
  const finishAvailability = {}, variantAvailability = {}
  for (const v of variants) {
    const plating = String(v.plating_code || '').trim().toUpperCase()
    const finishVariants = variants.filter(x=>String(x.plating_code || '').trim().toUpperCase()===plating)
    if (!Object.hasOwn(finishAvailability, plating)) finishAvailability[plating] = summary({...product,variants:finishVariants})
    for(const raw of (v.crystal_colors?.length ? v.crystal_colors : [v.crystal_code])) {
      if(!raw) continue
      const colour=String(raw).trim().toUpperCase(),key=`${plating}|${colour}`
      variantAvailability[key] = summary({...product,variants:finishVariants.map(x=>({...x,crystal_code:colour,crystal_colors:[colour]}))})
    }
  }
  const scoped = buildableFromComponents(product, components)
  return {
    verified:true, status:av.status, finishAvailability, variantAvailability, buildable:finite(av.buildable), finished:finite(av.finished),
    byPlating:quantities(av.byPlating), byVariant:quantities(scoped.byVariant),
    leadWeeks:finite(av.leadWeeks), effectiveMoq:finite(av.effectiveMoq),
    customerPromise:av.customerPromise, checkedAt:now().toISOString(),
  }
}

export function createAvailabilityHandler({ verifyToken, getProfile, getProduct, getComponents, getDefaults, now }) {
  return async req => {
    if (req.method !== 'POST') return json({error:'Method not allowed'},405)
    const token = (req.headers.get('authorization') || '').match(/^Bearer (\S+)$/i)?.[1]
    if (!token || token.length > 8192) return json({error:'Sign in required'},401)
    let uid
    try { uid = (await verifyToken(token)).uid; if (!uid) throw new Error() }
    catch { return json({error:'Sign in required'},401) }
    try {
      const profile = await getProfile(uid)
      if (!profile || !(profile.role === 'admin' || (profile.role === 'customer' && profile.status === 'approved'))) return json({error:'Access denied'},403)
      let body
      try { const text = await req.text(); if(text.length > 2048) return json({error:'Invalid request'},400); body=JSON.parse(text) }
      catch { return json({error:'Invalid request'},400) }
      const id = body?.productId
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return json({error:'Invalid product'},400)
      const product = await getProduct(id)
      // Same publication boundary as FigurineShop, even when called directly.
      if (!product || product.active === false || product.status === 'retired') return json({error:'Product unavailable'},404)
      const refs = Array.isArray(product.critical_components) ? product.critical_components : []
      if(refs.length > 100) return json({error:'Availability needs review'},422)
      const [components,defaults] = await Promise.all([getComponents(refs),getDefaults()])
      return json({productId:id, availability:projectAvailability(product,components,defaults,now)})
    } catch { return json({error:'Availability temporarily unavailable'},503) }
  }
}
