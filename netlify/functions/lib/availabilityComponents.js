export async function loadAvailabilityComponents(db, reader, refs) {
  const componentFields = ['code','plating_code','stock_qty','reserved_qty','lead_time_weeks']
  const found = new Map()
  const ids = [...new Set(refs.map(r=>r.id).filter(id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)))]
  if(ids.length) for(const snap of await reader.getAll(...ids.map(id=>db.doc(`range_components/${id}`)),{fieldMask:componentFields})) if(snap.exists) found.set(snap.id,{...snap.data(),id:snap.id})
  const codes = [...new Set(refs.filter(r=>!found.has(r.id)).map(r=>String(r.code||'').trim().toUpperCase()).filter(Boolean))]
  for(let i=0;i<codes.length;i+=30) {
    const query = db.collection('range_components').where('code','in',codes.slice(i,i+30)).select(...componentFields)
    const snaps = reader === db ? await query.get() : await reader.get(query)
    for(const snap of snaps.docs) found.set(snap.id,{...snap.data(),id:snap.id})
  }
  return [...found.values()]
}
