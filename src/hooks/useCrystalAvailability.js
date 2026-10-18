import {useEffect,useState} from 'react'
import {authedUser} from '../firebase'
export default function useCrystalAvailability(productId,variantId) {
 const [state,setState]=useState({loading:false,result:null}),[retry,setRetry]=useState(0)
 useEffect(()=>{
  if(!productId||!variantId){setState({loading:false,result:null});return}
  let alive=true
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
  setState({loading:true,result:null})
  ;(async()=>{
   const user=await authedUser()
   const response=await fetch('/api/crystal-availability',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify({productId,variantId}),signal:controller.signal,cache:'no-store'})
   if(!response.ok)throw Error()
   const data=await response.json()
   if(data.productId!==productId||data.variantId!==variantId)throw Error()
   if(alive)setState({loading:false,result:data.availability})
  })().catch(()=>{if(alive)setState({loading:false,result:null})}).finally(()=>clearTimeout(timer))
  return()=>{alive=false;controller.abort();clearTimeout(timer)}
 },[productId,variantId,retry])
 return {...state,retry:()=>setRetry(n=>n+1)}
}
