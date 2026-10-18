import { useEffect, useState, useRef } from 'react'
import { fetchSwatchImageUrl } from '../swatchLibraryApi'

export default function SwatchPhoto({ path, alt, className = 'w-full h-full object-contain', enabled = true }) {
  const [url,setUrl]=useState(''), [error,setError]=useState(''), [retry,setRetry]=useState(0)
  const element=useRef(null), [inView,setInView]=useState(false)
  useEffect(()=>{
    if(!enabled || inView)return
    const observer=new IntersectionObserver(([entry])=>{
      if(entry.isIntersecting){setInView(true);observer.disconnect()}
    },{rootMargin:'200px'})
    if(element.current)observer.observe(element.current)
    return()=>observer.disconnect()
  },[enabled,inView])
  useEffect(()=>{
    if(!enabled || !inView || !path)return
    let alive=true, objectUrl
    const controller=new AbortController()
    setUrl('');setError('')
    fetchSwatchImageUrl(path,{signal:controller.signal}).then(value=>{
      if(!alive){URL.revokeObjectURL(value);return}
      objectUrl=value;setUrl(value)
    }).catch(e=>{if(alive)setError(e.message)})
    return()=>{alive=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[path,enabled,inView,retry])
  return <div ref={element} className="w-full h-full flex items-center justify-center">{url ? <img src={url} alt={alt} className={className} /> : <div className="p-2 text-xs text-ink-60 text-center" role={error?'alert':undefined}>
    {error ? <><p>Photo unavailable</p><button type="button" className="btn-ghost min-h-10" onClick={e=>{e.stopPropagation();setRetry(n=>n+1)}}>Retry photo</button></> : 'Loading photo…'}
  </div>}</div>
}
