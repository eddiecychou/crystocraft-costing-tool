// Shared preview/server merge policy. Notes from both records always survive.
const contactsOf = customer => {
  if (customer.contacts?.length) return customer.contacts
  const first = (plural,single) => Array.isArray(customer[plural]) ? customer[plural][0] || '' : customer[single] || ''
  const person={id:'legacy',name:customer.contact_name || '',email:first('contact_emails','contact_email'),phone:first('contact_phones','contact_phone'),whatsapp:first('contact_whatsapps','whatsapp'),wechat:first('contact_wechats','wechat'),is_primary:true}
  return person.name || person.email || person.phone || person.whatsapp || person.wechat ? [person] : []
}
const SCALARS = ['website','address','country','crm_category','crm_status','source','segment','erp_code','folder_path']
export function customerMergeFields(survivor, source) {
  const out = {}
  for (const key of SCALARS) if (!String(survivor[key] || '').trim() && String(source[key] || '').trim()) out[key] = source[key]
  for (const key of ['tags','channels','linked_marketing_contact_ids']) {
    const values = [...new Set([...(survivor[key] || []), ...(source[key] || [])])]
    if (values.length !== (survivor[key] || []).length) out[key] = values
  }
  for (const key of ['is_vip','is_personal_wa','sensitive']) if (!survivor[key] && source[key]) out[key] = true
  const own = String(survivor.notes || '').trim(), other = String(source.notes || '').trim()
  if (other && other !== own) out.notes = own ? `${own}\n\n— From ${source.company_name || source.name || 'merged customer'} —\n${other}` : other
  const contacts = [...(contactsOf(survivor))]
  for (const person of contactsOf(source)) {
    if (contacts.some(c => JSON.stringify(c) === JSON.stringify(person))) continue
    let id = person.id || `merged-contact-${contacts.length}`
    while (contacts.some(c => c.id === id)) id = `merged-${id}`
    contacts.push({...person, id, is_primary: contacts.length ? false : Boolean(person.is_primary)})
  }
  if (contacts.length !== (contactsOf(survivor)).length) out.contacts = contacts
  return out
}
// Keep contact references pointing at the source person after a same-ID collision.
export function customerMergeContactMap(survivor, source) {
  const contacts=[...(contactsOf(survivor))], map={}
  for(const person of contactsOf(source)) {
    const same=contacts.find(c=>JSON.stringify(c)===JSON.stringify(person))
    if(same){if(person.id)map[person.id]=same.id;continue}
    let id=person.id || `merged-contact-${contacts.length}`
    while(contacts.some(c=>c.id===id))id=`merged-${id}`
    if(person.id)map[person.id]=id
    contacts.push({...person,id})
  }
  return map
}
