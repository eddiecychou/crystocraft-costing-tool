import { useSyncExternalStore } from 'react'
import { createOcDayStore } from '../ocDay'

const calendar = createOcDayStore()

export default function useOcToday() {
  return useSyncExternalStore(calendar.subscribe, calendar.getSnapshot, calendar.getSnapshot)
}
