// Fictional CRM boundaries only. Components, hooks, dates and markup stay real.
import { resolve } from 'node:path'

export function crmFixturePlugin() {
  const stubs = new Map([
    ['src/firebase', 'export const db={};'],
    ['src/customerAssets', 'export const useCustomerAssets=id=>({assets:globalThis.__crmFixture.assets[id]||[]});export const cannotRenderAsImage=name=>/\\.pdf$/i.test(name);'],
    ['src/customerProposal', 'export const loadProposal=id=>globalThis.__crmFixture.call("proposal",id);'],
    ['src/lib/pdConcepts', 'export const listApprovedConcepts=id=>globalThis.__crmFixture.call("concepts",id);'],
    ['src/currency', 'export const CUSTOMER_CURRENCIES=["USD","HKD","EUR"];export const useRates=()=>({HKD:7.8});export const fromUSD=(v,cur,rates)=>v*rates[cur];'],
    ['src/domain/customer', 'export const CHANNELS=["Email","WhatsApp Business"];export const loadCustomers=()=>globalThis.__crmFixture.call("customers");export const previewCustomerMerge=(...a)=>globalThis.__crmFixture.call("preview",...a);export const mergeCustomers=(...a)=>globalThis.__crmFixture.call("merge",...a);'],
    ['src/domain/interactionLog', 'export const listInteractions=(...a)=>globalThis.__crmFixture.call("interactions",...a);export const addInteraction=(...a)=>globalThis.__crmFixture.call("addInteraction",...a);export const deleteInteraction=(...a)=>globalThis.__crmFixture.call("deleteInteraction",...a);'],
    ['src/domain/whatsappImport', 'export const WHATSAPP_TRANSCRIBE_LANGUAGES=[{value:"zh-HK",label:"Cantonese"},{value:"en",label:"English"}];export const transcribeMessage=(...a)=>globalThis.__crmFixture.call("transcribe",...a);'],
    ['src/emailSummaryApi', 'export const renderThreadsText=threads=>threads.map(t=>t.subject).join("\\n");export const refreshEmailSummary=(...a)=>globalThis.__crmFixture.call("email",...a);'],
    ['src/whatsappSummaryApi', 'export const generateAndSaveWhatsappSummary=(...a)=>globalThis.__crmFixture.call("whatsapp",...a);'],
    ['src/alibabaSummaryApi', 'export const savePastedAlibabaThread=(...a)=>globalThis.__crmFixture.call("paste",...a);export const generateAndSaveAlibabaSummary=(...a)=>globalThis.__crmFixture.call("alibaba",...a);'],
    ['src/components/BrandQuickView', 'import React from "react";export default function BrandQuickView({customerId}){return React.createElement("p",null,"Design brand profile for "+customerId)}'],
  ].map(([path, contents]) => [resolve(path), contents]))
  return { name: 'fictional-crm-boundaries', setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'crm-qa' }))
    b.onResolve({ filter: /^\.\.?\// }, a => {
      const path = resolve(a.resolveDir, a.path)
      if (stubs.has(path)) return { path, namespace: 'crm-qa' }
    })
    b.onLoad({ filter: /.*/, namespace: 'crm-qa' }, a => ({ loader: 'js', contents: a.path === 'firestore'
      ? 'export const collection=(_, ...a)=>a.join("/");export const doc=(_, ...a)=>a.join("/");export const onSnapshot=(path,cb)=>globalThis.__crmFixture.subscribe(path,cb);export const serverTimestamp=()=>({serverTimestamp:true});export const updateDoc=(...a)=>globalThis.__crmFixture.call("write",...a);'
      : stubs.get(a.path) }))
  } }
}

export function createCrmFixture() {
  const f = { calls: [], subscriptions: new Map(), closed: [], data: {}, assets: {}, handlers: {}, logs: [] }
  f.emit = path => {
    const docs = (f.data[path] || []).map(({ id, ...data }) => ({ id, data: () => data }))
    for (const cb of f.subscriptions.get(path) || []) cb({ docs })
  }
  f.subscribe = (path, cb) => {
    const listeners = f.subscriptions.get(path) || new Set()
    f.subscriptions.set(path, listeners); listeners.add(cb); f.emit(path)
    return () => { listeners.delete(cb); f.closed.push(path) }
  }
  f.call = async (name, ...args) => {
    f.calls.push([name, ...args])
    if (f.handlers[name]) return f.handlers[name](...args)
    if (name === 'proposal') return null
    if (name === 'concepts' || name === 'customers') return []
    if (name === 'interactions') return [...f.logs]
    if (name === 'addInteraction') { f.logs.push({ id: 'new', ...args[2] }); return }
    if (name === 'deleteInteraction') { f.logs = f.logs.filter(x => x.id !== args[2]); return }
    if (['email', 'whatsapp', 'alibaba'].includes(name)) return { summary: 'Refreshed fictional summary' }
    if (['write', 'paste', 'transcribe'].includes(name)) return
    throw Error('Unexpected fixture action: ' + name)
  }
  return f
}
