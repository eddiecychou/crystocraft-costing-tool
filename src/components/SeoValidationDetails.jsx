export default function SeoValidationDetails({ validation = {}, allow = [] }) {
  const checks = validation.checks || []
  const firstLayout = checks.find(c => c.ok === true && c.detail?.startsWith('no prior _elementor_data'))
  return <>
    {firstLayout && <p className="mt-1 text-xs text-ink-60">{firstLayout.detail}</p>}
    {!!allow.length && <div className="mt-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
      <p>Requested validation exceptions — review before approving</p>
      {allow.map(entry => {
        const result = checks.find(c => c.name === entry.check)
        return <div key={entry.check} className="mt-1 break-words">
          <p><strong>{entry.check}</strong>: {entry.why}
            {' · '}{result?.overridden ? 'applied; original failure retained' : 'not applied'}</p>
          {result?.ok === false && result.detail && <p>Original result: {result.detail}</p>}
        </div>
      })}
    </div>}
  </>
}
