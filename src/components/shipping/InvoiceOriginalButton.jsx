import { useEffect, useRef, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { authedUser } from '../../firebase'
import CustomerFilePreview from '../crm/CustomerFilePreview'

export default function InvoiceOriginalButton({ invoiceNo, uid }) {
  const request = useRef(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => request.current?.abort(), [])

  function close() {
    request.current?.abort()
    request.current = null
    setPreview(null)
    setBusy(false)
    setError('')
  }

  async function read(download = false) {
    if (request.current || (download && !preview)) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const user = await authedUser()
      if (!user || user.uid !== uid) throw Error('Please sign in again.')
      const headers = { Authorization: `Bearer ${await user.getIdToken()}` }
      if (download) headers['If-Match'] = preview.version
      const response = await fetch(`/api/oc-invoice-summaries?${new URLSearchParams({ pdf: invoiceNo })}`, {
        headers, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        if (download && response.status >= 400 && response.status < 500 && !controller.signal.aborted) setPreview(null)
        throw Error(body?.error || 'The original could not be opened. Please retry.')
      }
      const blob = await response.blob()
      const version = response.headers.get('ETag')
      if (blob.type !== 'application/pdf' || !blob.size || !version) throw Error('Incomplete PDF response. Please retry.')
      const encodedName = response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const filename = encodedName ? decodeURIComponent(encodedName) : `${invoiceNo}.pdf`
      controller.signal.throwIfAborted()
      if (download) {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000) }
      } else {
        setPreview({ blob, file: { filename }, version })
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.name === 'TimeoutError' ? 'The request timed out. Please retry.' : failure.message)
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }

  const message = error && <span role="alert" className="block whitespace-normal text-xs text-brand-600">{error}</span>
  return <>
    <button type="button" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline disabled:opacity-60"
      onClick={() => read()} disabled={busy}>
      <FileText size={12} /> {busy && !preview ? 'Opening…' : 'View original'}
    </button>
    {!preview && message}
    {preview && <CustomerFilePreview file={preview.file} blob={preview.blob} onClose={close}
      title={`Original invoice ${invoiceNo}`} actions={<div className="px-4 pb-3 text-left">
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => read(true)} disabled={busy}>
          <Download size={14} /> {busy ? 'Downloading…' : 'Download original'}
        </button>
        {message}
      </div>} />}
  </>
}
