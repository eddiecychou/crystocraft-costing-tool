import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {JSDOM} from 'jsdom'
import {pdNavigationFixture} from './pd-navigation-fixture.mjs'
let dom,scratch,components
const pages=[['Customer brand','/design/customers/:id/brand','src/pages/pd/CustomerBrand.tsx'],['New project','/design/projects/new','src/pages/pd/Projects.jsx','DesignProjectDetail'],['Project detail','/design/projects/:id','src/pages/pd/Projects.jsx','DesignProjectDetail'],['New product','/design/products/new','src/pages/pd/ProductNew.tsx'],['New template','/design/products/:id/templates/new','src/pages/pd/TemplateNew.tsx'],['New spec sheet','/design/products/:id/spec-sheet/new','src/pages/pd/SpecSheetNew.tsx'],['Spec sheet','/design/spec-sheets/:id','src/pages/pd/SpecSheetDetail.tsx'],['Product detail','/design/products/:id','src/pages/pd/ProductDetail.tsx'],['Product edit','/design/products/:id/edit','src/pages/pd/ProductEdit.tsx'],['Template detail','/design/templates/:id','src/pages/pd/TemplateDetail.tsx'],['Template edit','/design/templates/:id/edit','src/pages/pd/TemplateEdit.tsx'],['Projects','/design/projects','src/pages/pd/Projects.jsx'],['Gallery','/design/products','src/pages/pd/Products.tsx'],['Templates','/design/templates','src/pages/pd/Templates.tsx'],['Generations','/design/generations','src/pages/pd/Generations.tsx'],['Guide','/design/tools','src/pages/pd/DesignHome.tsx']]
before(async()=>{
 dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost'});for(const n of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[n]=dom.window[n];globalThis.IS_REACT_ACT_ENVIRONMENT=true
 scratch=await mkdtemp(resolve('node_modules/.pd-navigation-'))
 await build({entryPoints:Object.fromEntries(pages.map(([name,,path])=>[name,path])),outdir:scratch,outExtension:{'.js':'.mjs'},bundle:true,jsx:'automatic',format:'esm',platform:'node',external:['react','react-dom','react-router-dom','lucide-react'],plugins:[pdNavigationFixture()]})
 components=Object.fromEntries(await Promise.all(pages.map(async([name,,,exportName='default'])=>[name,(await import(pathToFileURL(join(scratch,name+'.mjs'))))[exportName]])))
})
after(async()=>{dom.window.close();await rm(scratch,{recursive:true,force:true})})
async function fixture(path,fn){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);try{await act(async()=>root.render(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Routes,null,...pages.map(([name,url])=>React.createElement(Route,{key:name,path:url,element:React.createElement(components[name])}))))));await fn(host)}finally{await act(async()=>root.unmount());host.remove()}}
for(const [name,path] of pages)test(`${name} has shared navigation, current section, all tools and working Projects return`,async()=>fixture(path.replace(':id','qa'),async host=>{
 const nav=host.querySelector('nav[aria-label="Product Design navigation"]'),projects=nav.querySelector('a'),button=nav.querySelector('button'),panel=document.getElementById(button.getAttribute('aria-controls'))
 assert.equal(projects.getAttribute('href'),'/design/projects');assert.equal(projects.getAttribute('aria-current'),path.startsWith('/design/projects')?'page':null)
 assert.equal(button.getAttribute('aria-expanded'),path.startsWith('/design/projects')?'false':'true');assert.equal(panel.hidden,path.startsWith('/design/projects'));assert.equal(panel.querySelectorAll('a').length,4)
 if(!path.startsWith('/design/projects'))assert.equal(panel.querySelector('a[aria-current="page"]')?.getAttribute('href')??null,path.includes('/customers/')?null:path.includes('/templates/new')?'/design/templates':path.includes('/spec-sheets/')||path==='/design/products/new'?'/design/products':path.split('/:id')[0])
 await act(async()=>button.click());assert.equal(panel.hidden,!path.startsWith('/design/projects'));await act(async()=>button.click());assert.equal(panel.hidden,path.startsWith('/design/projects'))
 await act(async()=>projects.click());assert.ok(host.querySelector('h1').textContent.includes('Design projects'));assert.equal(host.querySelector('nav[aria-label="Product Design navigation"] button').getAttribute('aria-expanded'),'false')
}))
test('tool-to-tool navigation updates the selected destination and retains a Projects return',async()=>fixture('/design/products',async host=>{
 await act(async()=>host.querySelector('nav[aria-label="Product Design tools"] a[href="/design/templates"]').click());assert.equal(host.querySelector('h1').textContent,'Prompt Templates')
 const panel=host.querySelector('nav[aria-label="Product Design tools"]');assert.equal(panel.hidden,false);assert.equal(panel.querySelector('a[aria-current="page"]')?.getAttribute('href')??null,'/design/templates');assert.ok(host.querySelector('nav[aria-label="Product Design navigation"] a[href="/design/projects"]'))
}))

for(const [name,path] of pages.filter(p=>p[1].includes(':id')&&!p[1].startsWith('/design/projects')))for(const state of ['missing','loading'])test(`${name} retains navigation when ${state}`,async()=>fixture(path.replace(':id',state),async host=>{assert.ok(host.querySelector('nav[aria-label="Product Design navigation"]'));assert.ok(host.textContent.includes(state==='missing'?'not found':'Loading'));await act(async()=>host.querySelector('nav[aria-label="Product Design navigation"] a').click());assert.equal(host.querySelector('h1').textContent,'Design projects')}))

test('new template without photos retains Projects and template selection',async()=>fixture('/design/products/no-photos/templates/new',async host=>{assert.ok(host.textContent.includes('no reference photos'));assert.equal(host.querySelector('nav[aria-label="Product Design tools"] [aria-current="page"]').getAttribute('href'),'/design/templates');await act(async()=>host.querySelector('nav[aria-label="Product Design navigation"] a').click());assert.equal(host.querySelector('h1').textContent,'Design projects')}))
test('spec sheet with a missing linked product has a return instead of a loading dead end',async()=>fixture('/design/spec-sheets/missing-product',async host=>{assert.ok(host.textContent.includes('Spec sheet not found.'));assert.ok(host.querySelector('nav[aria-label="Product Design navigation"]'))}))

test('every registered Product Design page has an actual-page navigation fixture',async()=>{const app=await readFile('src/App.jsx','utf8');const routes=[...app.matchAll(/<Route path="(\/design[^" ]*)"/g)].map(m=>m[1]).filter(p=>p!=='/design');assert.deepEqual(new Set(pages.map(p=>p[1])),new Set(routes))})
test('customer without an existing brand profile still has shared navigation',async()=>fixture('/design/customers/empty-brand/brand',async host=>{assert.ok(host.textContent.includes('Create Brand Profile'));assert.ok(host.querySelector('nav[aria-label="Product Design navigation"]'))}))
