import {useState,useEffect} from 'react'
import {doc,getDoc} from 'firebase/firestore'
import {db} from '../firebase'
import SwatchPhoto from './SwatchPhoto'
export default function CrystalProductPhoto({product}) {
 const [state,setState]=useState(null),[retry,setRetry]=useState(0)
 useEffect(()=>{
  let alive=true;setState(null)
  if(!product.hero_id)return
  getDoc(doc(db,'crystal_products',product.id,'images',product.hero_id)).then(s=>{if(alive)setState(s.exists()?{media:s.data().media}: {error:true})}).catch(()=>{if(alive)setState({error:true})})
  return()=>{alive=false}
 },[product.id,product.hero_id,retry])
 if(state?.media)return <SwatchPhoto path={state.media.thumbnail} alt={product.name}/>
 return <div className="p-3 text-xs text-ink-60 text-center">{state?.error?<><p>Photo unavailable</p><button className="btn-ghost min-h-10" onClick={e=>{e.preventDefault();setRetry(n=>n+1)}}>Retry photo</button></>:product.hero_id?'Loading photo…':'Photograph pending'}</div>
}
