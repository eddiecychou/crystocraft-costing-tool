import { useEffect, useState } from 'react'
import { collection, collectionGroup, doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db, authedUser } from '../firebase'
import { cleanWorkItem, assertRevision, legacyWorkItems } from '../customerWorkItems'

// Same customers capability as the interaction history; never customer-portal readable.
export function useCustomerWorkItems(ids) {
  const key = [...new Set(ids)].sort().join('|')
  const [result, setResult] = useState({ items: [], error: '', loading: true })
  useEffect(() => {
    const customers = key ? key.split('|') : []
    let active = true
    const publish = value => { if (active) setResult(value) }
    if (!customers.length) { publish({items:[], error:'', loading:false}); return () => { active = false } }
    const allowed = new Set(customers)
    const target = customers.length === 1 ? collection(db, 'customers', customers[0], 'work_items') : collectionGroup(db, 'work_items')
    const stop = onSnapshot(target, snap => publish({ items: snap.docs.filter(d => d.ref.parent.parent?.parent.id === 'customers' && allowed.has(d.ref.parent.parent.id))
      .map(d => ({ ...d.data(), id:d.id, customerId:d.ref.parent.parent.id })), error:'', loading:false }),
      () => publish({items:[], error:'Customer tasks could not load. Refresh or check your access.', loading:false}))
    return () => { active = false; stop() }
  }, [key])
  return result
}

export async function saveCustomerWorkItem(customerId, original, input, createId) {
  const clean = cleanWorkItem(input)
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const legacy = original?.source === 'interaction'
  const target = doc(db, 'customers', customerId, legacy ? 'enquiries' : 'work_items', original?.id || createId)
  await runTransaction(db, async tx => {
    const snap = await tx.get(target)
    if (original) {
      assertRevision(snap.exists() ? snap.data() : null, original.revision || 0, legacy ? 'todo_revision' : 'revision')
      if (legacy) {
        const current = legacyWorkItems([{...snap.data(), id: original.id}])[0]
        if (!current || ['text','due_on','state'].some(key => current[key] !== original[key])) throw new Error('This follow-up changed in another tab. Close the editor and reopen it.')
        // Preserve original date, description, sales status, attachments and follow_up_date.
        tx.update(target, { todo_text: clean.text, todo_due_on: clean.due_on, todo_status: clean.state,
          todo_revision: (original.revision || 0)+1, todo_updated_by: user.uid, updatedAt: serverTimestamp() })
      } else tx.update(target, { ...clean, revision: original.revision+1, updated_by: user.uid, updatedAt: serverTimestamp() })
    } else if (!snap.exists()) {
      tx.set(target, { ...clean, revision: 1, created_by: user.uid, updated_by: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    } else {
      // Stable form ID makes a retry after an uncertain successful save safe.
      const previous = snap.data()
      if (previous.created_by !== user.uid || Object.entries(clean).some(([k,v]) => previous[k] !== v)) throw new Error('This draft was already saved. Close and reopen it before changing it.')
    }
  })
}
