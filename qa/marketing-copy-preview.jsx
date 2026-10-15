import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import MarketingCopyBulk from '../src/pages/MarketingCopyBulk'
import {addFixtureProduct, fixtureRecords} from 'firebase/firestore'
localStorage.setItem('oc-marketing-regeneration-v1',JSON.stringify({runId:'existing-run',entries:{
 awaiting:{status:'previewed',before:'',after:'Existing preview',approved:false},
 failed:{status:'preview_failed',error:'Seeded generation failure'},
 stale:{status:'previewed',before:'Old copy',after:'Stale preview',approved:true}
}}))
window.fetch = async()=>({ok:true,json:async()=>({marketing_description:'Fresh replacement copy'})})
createRoot(document.getElementById('root')).render(<MemoryRouter><MarketingCopyBulk embedded /></MemoryRouter>)
const results=[]
const check=(ok,name)=>{results.push({ok:Boolean(ok),name});if(!ok)throw Error(name)}
const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30))}throw Error('UI wait timed out')}
const button=(text)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
const card=(name)=>[...document.querySelectorAll('.card')].find(c=>c.querySelector('p.font-medium')?.textContent===name)
async function run(){
 try {
 await wait(()=>card('Failed product'))
 check(document.body.innerText.includes('All 5 current Corp Gift products'),'All current products included')
 check(button('Awaiting approval (2)') && button('Already compliant (1)') && button('Failed (1)'),'Separate review groups')
 check(card('Awaiting product').innerText.includes('Existing preview'),'Legacy preview preserved')
 check(card('Changed product').querySelector('input').disabled,'Stale approval blocked')
 check(button('Save 0 approved')?.disabled,'Stale approved entries excluded from save count')
 button('Failed (1)').click()
 await wait(()=>!card('Awaiting product'))
 check(Boolean(card('Failed product')),'Failure filter isolates errors')
 card('Failed product').querySelector('button').click()
 await wait(()=>button('Failed (0)'))
 button('Awaiting approval (3)').click()
 await wait(()=>card('Failed product')?.querySelector('input'))
 check(!card('Failed product').innerText.includes('Seeded generation failure'),'Retry clears failure and returns to review')
 card('Failed product').querySelector('input').click()
 await wait(()=>button('Save 1 approved'))
 button('Save 1 approved').click()
 await wait(()=>button('Saved (1)'))
 const saved=new Map(fixtureRecords())
 check(saved.get('products/failed').marketing_description==='Fresh replacement copy','Approved copy saved')
 check([...saved.keys()].some(k=>k.startsWith('product_marketing_history/existing-run_failed_')),'Atomic history backup retained existing run')
 addFixtureProduct()
 await wait(()=>document.body.innerText.includes('All 6 current Corp Gift products'))
 check(Boolean(button('Needs copy (2)')),'Product added while open included automatically')
 button('All products (6)').click()
 await wait(()=>card('Added while open'))
 check(document.documentElement.scrollWidth<=window.innerWidth,'No page horizontal overflow')
 }catch(error){results.push({ok:false,name:error.message})}
 const report=document.createElement('pre');report.id='qa-results';report.textContent=JSON.stringify(results);document.body.append(report); window.parent.postMessage(results,'*')
}
run()
