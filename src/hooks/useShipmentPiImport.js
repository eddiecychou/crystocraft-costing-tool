import { useCallback, useEffect, useRef, useState } from 'react'
import { authHeader } from '../firebase'
import { adoptErpLineUnits, diffLines, fetchErpSoLines } from '../erpSoImport'
import { preparePiUploadFile } from '../piUploadFile'
import { autoMatchLines } from '../shipping'

const soKey = value => String(value || '').trim().toUpperCase()

export function useShipmentPiImport({ rangeProducts, canImport, onParsed, onAdopt, onError, originalFile }) {
  const [pendingFile, setPendingFile] = useState(null)
  const [importingFileName, setImportingFileName] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [erpCheck, setErpCheck] = useState(null)
  const attemptRef = useRef(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      attemptRef.current = null
    }
  }, [])

  const resetPiImport = useCallback(() => {
    attemptRef.current = null
    setPendingFile(null)
    setImportingFileName(null)
    setExtracting(false)
    setErpCheck(null)
  }, [])

  function invalidatePiComparison() {
    if (attemptRef.current) attemptRef.current.soNo = ''
    setErpCheck(null)
  }

  // The object itself is the attempt identity. Replacing or abandoning it
  // invalidates both extraction and the ERP response for that upload.
  const isCurrent = attempt => mounted.current && attemptRef.current === attempt

  async function checkAgainstErp(soNo, parsedLines, attempt) {
    if (!soNo) return
    try {
      const erp = await fetchErpSoLines(soNo)
      const checkedSo = soKey(soNo)
      if (!erp || !isCurrent(attempt) || attempt.soNo !== checkedSo) return
      setErpCheck({ attempt, soNo: checkedSo, erp, diff: diffLines(parsedLines, erp) })
    } catch (error) {
      console.error('ERP SO cross-check failed', error)
    }
  }

  async function importFile(file) {
    if (!mounted.current || !canImport()) return
    const attempt = { extracting: true, soNo: '' }
    attemptRef.current = attempt
    setImportingFileName(file.name)
    setErpCheck(null)
    setExtracting(true)
    onError('')
    try {
      const payload = await preparePiUploadFile(file)
      const auth = await authHeader()
      if (!isCurrent(attempt)) return
      const res = await fetch('/api/extract-pi', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Extraction failed')
      const data = await res.json()
      if (!isCurrent(attempt)) return

      const matched = autoMatchLines(data.lines || [], rangeProducts)
      attempt.soNo = soKey(data.so_no)
      onParsed(data, matched)
      setPendingFile(file)
      if (!matched.length) onError('No line items found — check the file or add lines manually.')
      checkAgainstErp(data.so_no, matched, attempt)
    } catch (error) {
      if (!isCurrent(attempt)) return
      onError(error.code === 'pi-file-too-large'
        ? `${error.message} The existing fields and lines have been kept; this file was not attached.`
        : `Could not read this PI (${file.name}) — the existing fields and lines have been kept. The failed file was not attached; try another file or continue manually.`)
    } finally {
      if (isCurrent(attempt)) {
        attempt.extracting = false
        setExtracting(false)
        setImportingFileName(null)
      }
    }
  }

  function useErpLines(soNo, draftLines) {
    if (!erpCheck || !isCurrent(erpCheck.attempt) || erpCheck.attempt.extracting
        || erpCheck.attempt.soNo !== erpCheck.soNo || soKey(soNo) !== erpCheck.soNo) return
    const adopted = adoptErpLineUnits(erpCheck.erp, draftLines)
    onAdopt(autoMatchLines(adopted.lines, rangeProducts))
    setErpCheck({ ...erpCheck, adopted: true, defaultedLineNumbers: adopted.defaultedLineNumbers })
  }

  const attachedFile = pendingFile ?? originalFile
  return {
    pendingFile: attachedFile, fileName: importingFileName ?? attachedFile?.name,
    extracting, erpCheck, importFile, useErpLines, invalidatePiComparison, resetPiImport,
    isExtracting: () => Boolean(attemptRef.current?.extracting),
  }
}
