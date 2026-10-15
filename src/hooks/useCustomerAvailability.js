import { useEffect, useState } from 'react'
import { auth } from '../firebase'

export default function useCustomerAvailability(productId) {
  const [result,setResult] = useState(null)
  const [loading,setLoading] = useState(true)
  const [revision,setRevision] = useState(0)
  useEffect(()=>{
    let alive = true, pending = false
    let controller
    async function refresh() {
      if(pending || !productId) return
      pending = true; controller = new AbortController(); setLoading(true)
      const timeout=setTimeout(()=>controller.abort(),15000)
      try {
        const token = await auth.currentUser?.getIdToken()
        if(!token) throw new Error('Sign in required')
        const response = await fetch('/api/customer-availability',{
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body:JSON.stringify({productId}), signal:controller.signal, cache:'no-store',
        })
        if(!response.ok) throw new Error('Availability unavailable')
        const data = await response.json()
        if(data.productId !== productId || !data.availability) throw new Error('Invalid response')
        if(alive) setResult({productId,availability:data.availability})
      } catch { if(alive) setResult(null) }
      finally { clearTimeout(timeout); pending=false; if(alive) setLoading(false) }
    }
    refresh()
    const onFocus=()=>refresh()
    const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh()},30000)
    window.addEventListener('focus',onFocus)
    return ()=>{alive=false;controller?.abort();clearInterval(timer);window.removeEventListener('focus',onFocus)}
  },[productId,revision])
  return { availability:result?.productId===productId?result.availability:null, loading, retry:()=>setRevision(v=>v+1) }
}
