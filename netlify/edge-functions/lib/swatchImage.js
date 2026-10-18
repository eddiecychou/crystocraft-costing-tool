const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization'}
const error=(message,status)=>new Response(JSON.stringify({error:message}),{status,headers:{...headers,'Content-Type':'application/json'}})
export function createSwatchImageHandler({bucket,fetcher=fetch}) {
  return async req => {
    if(req.method!=='GET')return error('Method not allowed',405)
    const token=req.headers.get('authorization')?.match(/^Bearer ([a-zA-Z0-9_.-]+)$/)?.[1]
    if(!token)return error('Please sign in.',401)
    if(!bucket || !/^[a-z0-9.-]+$/.test(bucket))return error('Image storage is not configured.',503)
    const url=new URL(req.url),path=url.searchParams.get('file')||''
    if(url.searchParams.get('action')!=='image' || !/^crystal-swatches\/sw_[a-zA-Z0-9_-]{16,80}\/[a-f0-9]{64}\/(original\.(jpg|png|webp)|display\.jpg|thumbnail\.jpg)$/.test(path))return error('Invalid photograph.',400)
    try {
      const upstream=await fetcher(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`,{
        headers:{Authorization:`Firebase ${token}`},redirect:'error',signal:AbortSignal.timeout(25000),
      })
      if(!upstream.ok)return error('Photograph unavailable.',[401,403,404].includes(upstream.status)?upstream.status:502)
      const type=upstream.headers.get('Content-Type')?.split(';')[0]
      if(!['image/jpeg','image/png','image/webp'].includes(type))return error('Invalid photograph format.',502)
      return new Response(upstream.body,{headers:{...headers,'Content-Type':type}})
    }catch{return error('Photo could not be loaded. Please retry.',502)}
  }
}
