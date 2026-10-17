import { useSyncExternalStore } from 'react'
import { createLocalDayStore } from '../localDay'

const calendar = createLocalDayStore()

export default function useLocalToday() {
  return useSyncExternalStore(calendar.subscribe, calendar.getSnapshot, calendar.getSnapshot)
}
