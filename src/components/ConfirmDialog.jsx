import { useT } from '../i18n'

export default function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel, danger = true, busy = false }) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="absolute inset-0 bg-black/40" />
      <div role="dialog" aria-modal="true" aria-label="Confirm action" aria-busy={busy} className="relative bg-white rounded-none shadow-xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
        <p className="text-sm text-ink-80 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button type="button" disabled={busy} className="btn-secondary" onClick={onCancel}>{t('Cancel')}</button>
          <button type="button" disabled={busy} className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{t(busy ? 'Deleting…' : confirmLabel || 'Delete')}</button>
        </div>
      </div>
    </div>
  )
}
