import {useSyncExternalStore} from 'react'
import {createSummaryUpdateStore} from '../summaryUpdate'
import {generateWeeklySummary} from '../domain/weeklySummary'

const update = createSummaryUpdateStore(generateWeeklySummary)

export default function useSummaryUpdate() {
  const state = useSyncExternalStore(update.subscribe, update.getSnapshot, update.getSnapshot)
  return {...state, start:update.start}
}
