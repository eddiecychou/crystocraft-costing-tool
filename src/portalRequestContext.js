import { createContext } from 'react'

export const PortalRequestCount = createContext({
  count: 0, unavailable: false, refresh: () => {}
})
