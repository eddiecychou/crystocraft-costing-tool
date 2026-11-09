import { useCallback, useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { listAccountFollowupStates } from '../portalInviteApi'

const noRefresh = () => {}
export { PortalRequestCount } from '../portalRequestContext'

export function usePortalRequestCount(isAdmin) {
  const [state,setState] = useState({count:0,unavailable:false})
  const [pending,setPending] = useState(null)
  const [revision,setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1),[])
  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    setPending(null);setState({count:0,unavailable:false})
    const unsubscribe = onSnapshot(query(collection(db,'users'),where('status','==','pending')),
      snap => {if(alive)setPending(snap.docs.filter(doc => doc.data().role === 'customer').map(doc => doc.id))},
      () => {if(alive){setPending(null);setState({count:0,unavailable:true})}})
    return () => {alive=false;unsubscribe()}
  },[isAdmin])
  useEffect(() => {
    if (!isAdmin || !pending) return
    let alive = true
    ;(async () => {
      const waiting = new Set()
      for(let i=0;i<pending.length;i+=100){
        const result = await listAccountFollowupStates(pending.slice(i,i+100))
        if(!alive)return
        for(const item of result.states)if(item.waiting)waiting.add(item.uid)
      }
      if(alive)setState({count:pending.filter(uid => !waiting.has(uid)).length,unavailable:false})
    })().catch(() => {if(alive)setState({count:pending.length,unavailable:true})})
    return () => {alive=false}
  },[isAdmin,pending,revision])
  useEffect(() => {
    if(!isAdmin)return
    const timer=window.setInterval(refresh,30000)
    const visible=()=>{if(document.visibilityState==='visible')refresh()}
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visible)
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible)}
  },[isAdmin,refresh])
  return isAdmin ? {...state,refresh} : {count:0,unavailable:false,refresh:noRefresh}
}
