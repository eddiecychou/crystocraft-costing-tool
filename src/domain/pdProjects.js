import {collection,doc,getDoc,getDocs,query,orderBy,limit,startAfter,runTransaction,serverTimestamp} from 'firebase/firestore'
import {db,authedUser} from '../firebase'
import {cleanProject} from '../pdProjects'
export async function listDesignProjects(){const s=await getDocs(collection(db,'pd_projects'));return s.docs.map(d=>({...d.data(),id:d.id}))}
export async function getDesignProject(id){const s=await getDoc(doc(db,'pd_projects',id));return s.exists()?{...s.data(),id:s.id}:null}
export async function designProjectHistory(id,cursor=null){const parts=[orderBy('revision','desc'),...(cursor?[startAfter(cursor)]:[]),limit(50)],s=await getDocs(query(collection(db,'pd_projects',id,'updates'),...parts));return {items:s.docs.map(d=>({...d.data(),id:d.id})),cursor:s.docs.at(-1)||null,more:s.size===50}}
export async function saveDesignProject(id,original,input,note='',eventId=crypto.randomUUID(),kind='edit'){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^[A-Za-z0-9_-]{1,128}$/.test(eventId))throw Error('Invalid project or update ID.')
 const clean=cleanProject(input);if(typeof note!=='string'||note.length>2000)throw Error('Keep the decision/update within 2,000 characters.')
 if(!['edit','note'].includes(kind)||kind==='note'&&!note.trim())throw Error('Write an update first.')
 const user=await authedUser();if(!user)throw Error('Please sign in.')
 const target=doc(db,'pd_projects',id),event=doc(target,'updates',eventId)
 await runTransaction(db,async tx=>{
  const snap=await tx.get(target),previous=snap.exists()?snap.data():null
  // Historical retries must not recreate/overwrite a later revision.
  const receipt=await tx.get(event);if(receipt.exists()){const saved=receipt.data();if(saved.actor!==user.uid||saved.note!==note.trim()||JSON.stringify(cleanProject(saved.project))!==JSON.stringify(clean))throw Error('This update was already saved. Reopen the project before making another change.');return}
  if(original?(previous?.revision!==original.revision):!!previous)throw Error('This project changed in another tab. Reopen it before saving; your draft is still here.')
  if(kind==='note'&&!previous)throw Error('Save the project before adding updates.')
  const project={...(kind==='note'?previous:clean),revision:(previous?.revision||0)+1,createdAt:previous?.createdAt||serverTimestamp(),created_by:previous?.created_by||user.uid,updatedAt:serverTimestamp(),updated_by:user.uid,eventId}
  tx.set(target,project)
  tx.set(event,{kind:previous?kind:'create',note:note.trim(),actor:user.uid,actorLabel:user.email||user.uid,at:serverTimestamp(),revision:project.revision,previous:previous||{},project})
 })
 return id
}
