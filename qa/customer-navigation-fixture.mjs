// Real CustomerDetail, workspace hooks and Router. Only SDK IO and unrelated
// integrations are fictional; writes and unexpected network calls are forbidden.
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { workspaceSyncPlugin } from './customer-workspace-sync-fixture.mjs'

const emptyDoc = path => ({ id: path.split('/').at(-1), exists: () => false, data: () => undefined })
export function createCustomerNavigationFixture() {
  const f = { reads: [], customerRequests: [], listeners: [], writes: [], handlers: {}, unexpected: [] }
  f.getDoc = ref => {
    f.reads.push(['getDoc', ref.path])
    if (/^customers\/[^/]+$/.test(ref.path)) return new Promise((resolve, reject) => f.customerRequests.push({ id: ref.path.split('/')[1], resolve, reject }))
    if (ref.path === 'settings/email_sync_status') return Promise.resolve(emptyDoc(ref.path))
    f.unexpected.push(['getDoc', ref.path])
    return Promise.reject(Error('Unexpected fictional document read: ' + ref.path))
  }
  f.getDocs = async ref => {
    f.reads.push(['getDocs', ref.path, ref.clauses])
    if (!['client_quotes', 'products', 'users', 'orders', 'customers'].includes(ref.path)) {
      f.unexpected.push(['getDocs', ref.path]); throw Error('Unexpected fictional collection read: ' + ref.path)
    }
    if (f.handlers.getDocs) return f.handlers.getDocs(ref)
    return { docs: [], size: 0 }
  }
  f.subscribe = (ref, next) => {
    const entry = { ref, next, closed: false }
    f.listeners.push(entry)
    next({ docs: [], exists: () => false, data: () => undefined })
    return () => { entry.closed = true }
  }
  f.denyWrite = (...args) => { f.writes.push(args); throw Error('Business writes forbidden in customer navigation fixture') }
  f.request = (id, index = 0) => {
    const request = f.customerRequests.filter(r => r.id === id)[index]
    if (!request) throw Error('No pending fictional customer request: ' + id + ' #' + index)
    return request
  }
  return f
}
export const customerSnapshot = (id, data = {}) => ({ id, exists: () => true, data: () => ({ company_name: 'Fictional ' + id, contacts: [], tags: [], channels: [], contact_emails: [], ...data }) })

export async function customerNavigationPlugins(require) {
  const firestore = `
    const f=()=>globalThis.__customerNavigationFixture;
    export const doc=(_db,...parts)=>({path:parts.join('/')}); export const collection=doc,collectionGroup=doc;
    export const query=(ref,...clauses)=>({...ref,clauses}); export const where=(...parts)=>parts,orderBy=where;
    export const getDoc=ref=>f().getDoc(ref),getDocs=ref=>f().getDocs(ref);
    export const onSnapshot=(ref,next)=>f().subscribe(ref,next);
    export const deleteDoc=(...args)=>f().denyWrite('deleteDoc',...args),updateDoc=(...args)=>f().denyWrite('updateDoc',...args),setDoc=(...args)=>f().denyWrite('setDoc',...args),runTransaction=(...args)=>f().denyWrite('runTransaction',...args),serverTimestamp=(...args)=>f().denyWrite('serverTimestamp',...args);
  `
  const page = resolve('src/pages/CustomerDetail.jsx')
  return [{ name: 'customer-navigation-fictional-io', setup(b) {
    if (process.env.CUSTOMER_NAVIGATION_SOURCE) b.onLoad({ filter: /CustomerDetail\.jsx$/ }, async a => a.path === page
      ? { contents: await readFile(process.env.CUSTOMER_NAVIGATION_SOURCE, 'utf8'), loader: 'jsx', resolveDir: resolve('src/pages') } : undefined)
    b.onResolve({ filter: /^firebase\/(?:firestore|storage)$/ }, a => ({ path: a.path, namespace: 'navigation-sdk' }))
    b.onLoad({ filter: /.*/, namespace: 'navigation-sdk' }, a => ({ contents: a.path.endsWith('/firestore') ? firestore : "export const ref=(...args)=>globalThis.__customerNavigationFixture.denyWrite('storageRef',...args);export const deleteObject=ref;", loader: 'js' }))
    b.onResolve({ filter: /^(?:react(?:-dom|-router-dom)?(?:\/.*)?|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true }))
  } }, await workspaceSyncPlugin()]
}
