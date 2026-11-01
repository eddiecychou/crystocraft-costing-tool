// Real DailyDrafts page and state; only service/data boundaries are fictional.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function dailyDraftsFixturePlugin() {
  const categories = readFileSync('src/domain/customer.js', 'utf8').match(/export const CRM_CATEGORIES = \[[^\n]+/)[0]
  const boundary = names => names.map(name => `export const ${name}=(...args)=>globalThis.__dailyDraftsFixture.call(${JSON.stringify(name)},...args);`).join('\n')
  const stubs = new Map([
    ['src/firebase', 'export const db={};export const storage={};' + boundary(['authedUser'])],
    ['src/domain/customer', categories + ';\nexport const primaryContact=contacts=>contacts?.find(c=>c.is_primary)||contacts?.[0];\n' + boundary(['loadCustomers', 'getCustomer', 'saveCustomer'])],
    ['src/domain/marketingContact', 'export const normalizeContact=(id,data)=>({id,...data});\n' + boundary(['markContactOutreach', 'blockContactOutreach', 'promoteContactsToCustomers', 'linkContactToCustomer'])],
    ['src/domain/outreachDrafts', boundary(['listPendingDrafts', 'listDraftsForTopic', 'listSentDrafts', 'listRecentDecisions', 'createDrafts', 'markDraftSent', 'markDraftReplied', 'skipDraft', 'deleteAllPending', 'appendMemoryConclusion'])],
    ['src/domain/draftMemoryRules', 'export const MAX_ACTIVE_RULES=8;\n' + boundary(['listDraftMemoryRules', 'createDraftMemoryRule', 'approveDraftMemoryRule', 'rejectDraftMemoryRule', 'disableDraftMemoryRule', 'deleteDraftMemoryRule', 'updateDraftMemoryRuleText'])],
    ['src/domain/interactionLog', boundary(['addInteraction'])],
    ['src/domain/outreachTopicTemplates', boundary(['listTopicTemplates', 'saveTopicTemplate', 'updateTopicTemplate', 'deleteTopicTemplate'])],
    ['src/outreachApi', boundary(['generateDrafts', 'draftTopic', 'sendPersonalEmail', 'discussDraft'])],
    ['src/productSource', boundary(['loadBlogProducts', 'loadBlogImages'])],
    ['src/pages/CustomerAccounts', 'export const CustomerPicker=()=>null;'],
  ].map(([path, contents]) => [resolve(path), contents]))
  return { name: 'fictional-daily-drafts-boundaries', setup(b) {
    b.onResolve({ filter: /^firebase\/(firestore|storage)$/ }, a => ({ path: a.path, namespace: 'daily-drafts-qa' }))
    b.onResolve({ filter: /^\.\.?\// }, a => {
      const path = resolve(a.resolveDir, a.path)
      if (stubs.has(path)) return { path, namespace: 'daily-drafts-qa' }
    })
    b.onLoad({ filter: /.*/, namespace: 'daily-drafts-qa' }, a => ({ loader: 'js', contents: stubs.get(a.path) || (
      a.path === 'firebase/firestore'
        ? 'export const collection=(_, ...p)=>({kind:"collection",path:p.join("/")});export const collectionGroup=(_,name)=>({kind:"group",path:name});export const doc=(_, ...p)=>({path:p.join("/")});export const where=(...args)=>args;export const query=(ref,...filters)=>({...ref,filters});' + boundary(['getDoc', 'getDocs', 'serverTimestamp', 'updateDoc'])
        : boundary(['ref', 'uploadBytes', 'getDownloadURL'])
    ) }))
  } }
}

export function createDailyDraftsFixture() {
  const customer = (id, category, customer_type = null) => ({ id, company_name: 'Fictional ' + id,
    contacts: [{ name: 'Test contact', email: id + '@example.test', is_primary: true }],
    crm_category: category, crm_status: 'Active', customer_type })
  const f = { calls: [], handlers: {}, customers: [customer('trade', 'Distributor'), customer('gift', 'Gift / OEM'), customer('retail', '', 'retail')],
    contacts: [], prior: [], existing: [], pending: [], sent: [], rules: [] }
  f.call = async (name, ...args) => {
    f.calls.push([name, ...args])
    if (f.handlers[name]) return f.handlers[name](...args)
    if (name === 'loadCustomers') return f.customers
    if (name === 'listPendingDrafts') return f.pending
    if (name === 'listSentDrafts') return f.sent
    if (name === 'listDraftsForTopic') return f.existing
    if (name === 'listDraftMemoryRules') return f.rules
    if (['listRecentDecisions', 'listTopicTemplates', 'loadBlogProducts', 'loadBlogImages'].includes(name)) return []
    if (name === 'draftTopic') return { subject: 'Fictional master subject', body: 'Fictional approved message' }
    if (name === 'getDocs') {
      const rows = args[0].kind === 'group' ? f.prior : f.contacts
      const docs = rows.map(({ id, ...data }) => ({ id, data: () => data, ref: { parent: { parent: { id: data.parentId || id } } } }))
      return { docs, forEach: cb => docs.forEach(cb) }
    }
    if (name === 'generateDrafts') return []
    if (name === 'createDrafts') return
    // No unnoticed sends, uploads, CRM writes, account actions or real AI calls.
    throw Error('Unexpected fictional boundary: ' + name)
  }
  return f
}
