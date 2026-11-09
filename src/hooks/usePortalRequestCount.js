import { createContext, useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'

export const PortalRequestCount = createContext({
  count: 0,
  unavailable: false
})

export function usePortalRequestCount(isAdmin) {
  const [state, setState] = useState({ count: 0, unavailable: false })
  useEffect(() => {
    if (!isAdmin) return
    const pending = query(
      collection(db, 'users'),
      where('status', '==', 'pending')
    )
    return onSnapshot(
      pending,
      (snap) => {
        setState({
          count: snap.docs.filter((doc) => doc.data().role === 'customer')
            .length,
          unavailable: false
        })
      },
      () => setState({ count: 0, unavailable: true })
    )
  }, [isAdmin])
  return isAdmin ? state : { count: 0, unavailable: false }
}
