import {authedUser} from './firebase'
export async function fetchCustomerActivity({signal}={}) {
  const user=await authedUser()
  if(!user)throw Error('Please sign in.')
  const token=await user.getIdToken()
  const response=await fetch('/api/customer-workbench',{signal,cache:'no-store',headers:{Authorization:`Bearer ${token}`}})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw Error(data.error||'Contact history could not load.')
  if(!Array.isArray(data.customers)||!data.checkedAt||data.customers.some(c=>!c.customerId||!['known','partial','unknown'].includes(c.historyState)||(c.lastContactAt!==null&&!Number.isFinite(Date.parse(c.lastContactAt)))))throw Error('Contact history returned an incomplete response. Try again.')
  return data
}
