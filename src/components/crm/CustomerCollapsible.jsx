import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
// This page grew to a dozen-plus stacked sections over time (owner,
// post-launch: "too many sections, make it easy to expand/collapse"). One
// shared wrapper for all of them — title + optional right-side controls
// (buttons/links that stay clickable even when collapsed, via
// stopPropagation) in a clickable header row, body hidden when collapsed.
// Open/closed state is per customer + section (sessionStorage, keyed by
// `${customerId}:${sectionKey}`) so it survives a save/reload within the
// same visit without polluting localStorage forever or leaking one
// customer's layout preference onto another's page.
function readCollapsed(key, defaultOpen) {
  if (!key) return !defaultOpen
  try {
    const v = sessionStorage.getItem(`cd-collapse:${key}`)
    return v === null ? !defaultOpen : v === '1'
  } catch { return !defaultOpen }
}
export default function Collapsible({ storageKey, title, right, defaultOpen = true, children, className = 'card mb-4', bodyClassName = 'px-5 py-4' }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey, defaultOpen))
  function toggle() {
    setCollapsed(c => {
      const next = !c
      if (storageKey) { try { sessionStorage.setItem(`cd-collapse:${storageKey}`, next ? '1' : '0') } catch {} }
      return next
    })
  }
  return (
    <div className={className}>
      <div className={`flex flex-wrap items-center justify-between gap-2 px-5 py-4 cursor-pointer select-none ${!collapsed ? 'border-b border-warm-grey' : ''}`} onClick={toggle}>
        <div className="flex items-center gap-1.5 min-w-0">
          {collapsed ? <ChevronRight size={15} className="text-ink-60 shrink-0" /> : <ChevronDown size={15} className="text-ink-60 shrink-0" />}
          <h2 className="text-sm text-ink-80 truncate">{title}</h2>
        </div>
        {right && <div onClick={e => e.stopPropagation()} className="shrink-0 max-w-full flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {!collapsed && <div className={bodyClassName}>{children}</div>}
    </div>
  )
}
