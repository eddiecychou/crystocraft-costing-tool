import { useEffect, useRef, useState } from 'react'
import {
  beginOrderCopy,
  describePi,
  finishOrderRequest,
  orderRequestAction,
  samePiOriginal
} from '../orderCreateRequest'
import { ORDER_REQUEST_DRAFT_CONFLICT } from '../orderCreateRequestModel.js'
import {
  readOrderCreateDraft,
  removeOrderCreateDraft,
  saveOrderCreateDraft,
  separateOrderDraft
} from '../orderCreateDrafts.js'

export function useShipmentOrderRequest({
  operator, id, drafts, direct, initialError, openRequest, openOrder, openSeparateDraft
}) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const active = useRef(false)
  const inFlight = useRef(false)
  const selectedFile = useRef(null)
  const [openedForm, setOpenedForm] = useState(false)
  const draftKey = operator + ':' + id
  const [keptDraft, setKeptDraft] = useState(() =>
    drafts.get(draftKey) || readOrderCreateDraft(operator, id))
  const [originalFile, setOriginalFile] = useState(keptDraft?.file || null)
  const [checkingOriginal, setCheckingOriginal] = useState(false)
  const conflictDraft = keptDraft?.conflict ? keptDraft : null
  const initialDraft = conflictDraft ? null : keptDraft
  const needsOriginal = initialDraft?.original && !originalFile
  const key = { operator, id }

  async function check() {
    const result = await orderRequestAction('status', key)
    if (active.current) applyStatus(result)
    return result
  }

  function applyStatus(result) {
    setState(result)
    if (result.status === 'empty') setOpenedForm(true)
  }

  useEffect(() => {
    let alive = true
    active.current = true
    orderRequestAction('status', { operator, id })
      .then((result) => {
        if (alive) applyStatus(result)
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
      active.current = false
    }
  }, [operator, id])

  async function run(action, navigateOnSuccess = true) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (!active.current) return
      setState(result)
      if (result.id && result.id !== id)
        openRequest(result.id)
      else if (
        navigateOnSuccess && result.status === 'committed' &&
        (!result.direct ||
          ['issued', 'supplied'].includes(result.invoice?.state))
      )
        openOrder(result.order_id)
    } catch (err) {
      if (!active.current) return
      setError(err.message)
      try {
        await check()
      } catch {
        if (active.current) setState(null)
      }
    } finally {
      inFlight.current = false
      if (active.current) setBusy(false)
    }
  }
  function keepDraft(requestId, draft) {
    drafts.set(operator + ':' + requestId, draft)
    const { file: _file, ...rest } = draft
    saveOrderCreateDraft(operator, requestId, rest)
  }

  function useDraftForSeparateOrder() {
    if (inFlight.current || !conflictDraft) return
    const existingId = drafts.get(draftKey)?.separateId || conflictDraft.separateId
    const separateId = existingId || crypto.randomUUID()
    if (!existingId) {
      const draft = { ...separateOrderDraft(conflictDraft), file: conflictDraft.file }
      const source = { ...conflictDraft, separateId }
      keepDraft(separateId, draft)
      keepDraft(id, source)
      setKeptDraft(source)
    }
    openSeparateDraft(separateId, conflictDraft.direct)
  }

  async function attachDraftOriginal(file) {
    if (!file || checkingOriginal) return
    setCheckingOriginal(true)
    setError('')
    try {
      if (!samePiOriginal(await describePi(file), initialDraft.original))
        throw Error('Select the original PI named ' + initialDraft.original.name + '.')
      if (active.current) setOriginalFile(file)
    } catch (err) {
      if (active.current) setError(err.message)
    } finally {
      if (active.current) setCheckingOriginal(false)
    }
  }

  async function submit(order, lines, file, header) {
    if (needsOriginal) return
    selectedFile.current = file
    return run(async () => {
      const descriptor = await describePi(file)
      let saved
      try {
        saved = await orderRequestAction('prepare', {
          ...key, order, lines, file: descriptor, mode: direct ? 'direct' : undefined
        })
      } catch (err) {
        if (err.code === ORDER_REQUEST_DRAFT_CONFLICT) {
          const draft = { header, lines, original: descriptor, file, direct, conflict: true }
          keepDraft(id, draft)
          if (active.current) {
            setKeptDraft(draft)
            selectedFile.current = null
          }
        }
        throw err
      }
      if (initialDraft) {
        drafts.delete(draftKey)
        removeOrderCreateDraft(operator, id)
      }
      if (saved.status === 'review') return saved
      if (saved.status === 'committed' && !saved.direct) return saved
      return finishOrderRequest(key, file, saved.file)
    })
  }


  return {
    state, busy, error, openedForm, conflictDraft, initialDraft, originalFile,
    needsOriginal, checkingOriginal, attachDraftOriginal, submit, useDraftForSeparateOrder,
    checkSavedStatus: () => run(check, !conflictDraft),
    finishDirectInvoice: () => run(() => finishOrderRequest(key)),
    resumeOrder: () => run(() => finishOrderRequest(key, selectedFile.current, state.file)),
    selectOriginal: file => { selectedFile.current = file },
    makeAnotherCopy: () => run(() => beginOrderCopy(operator, state.source_id, id)),
  }
}
