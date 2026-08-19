import { useState } from 'react'
import { Check } from 'lucide-react'

// Shared copy-to-clipboard button — lifted from BlogGenerator.jsx's local
// copy (kept there unchanged; this is the reusable version for anywhere
// else that needs the same "Copy" -> "Copied!" flash, e.g. Supplier
// Workstation's WeChat ID fallback).
export default function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-brand-50 text-gray-600 hover:text-brand-700 transition-colors shrink-0">
      {copied ? <span className="inline-flex items-center gap-1"><Check size={12} />Copied!</span> : label}
    </button>
  )
}
