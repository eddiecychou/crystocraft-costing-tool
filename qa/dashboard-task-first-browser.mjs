import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const require=createRequire(process.cwd()+'/.qa-playwright/package.json'),{chromium}=require('playwright-core')
const before=process.argv.includes('--before'),out='qa/out/dashboard-task-first-v819'
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
await mkdir(out,{recursive:true})
const report=[]
try{
 for(const width of [320,375,414,1280]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5196')
  const card=page.locator('section[aria-label^="Summary and to-do"]').first()
  await card.waitFor()
  const metrics=await card.evaluate(el=>{
   const task=[...el.querySelectorAll('p')].find(p=>p.textContent==='Confirm revised sample details'),summary=el.querySelector('p[id]')
   return {taskTop:task.getBoundingClientRect().top,summaryTop:summary.getBoundingClientRect().top,previewCharacters:summary.textContent.length,cardHeight:el.getBoundingClientRect().height}
  })
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(!before){
   assert.ok(metrics.taskTop<metrics.summaryTop);assert.ok(metrics.previewCharacters<=201)
   const reference=card.getByRole('region',{name:'Email and conversation summary'})
   const tasks=await card.getByRole('list',{name:'To-do list',exact:true}).textContent()
   await reference.getByRole('button',{name:'Read full summary',exact:true}).click()
   await reference.getByText(/Final reference detail/).waitFor()
   assert.equal(await card.getByRole('list',{name:'To-do list',exact:true}).textContent(),tasks)
   await card.getByRole('button',{name:'Add task',exact:true}).click()
   await card.getByLabel('Task',{exact:true}).fill('Follow up after reviewing the summary')
   assert.ok(await card.getByLabel('Due date (optional)',{exact:true}).isVisible())
   await card.getByRole('button',{name:'Cancel',exact:true}).click()
   await reference.getByRole('button',{name:'Show less',exact:true}).click()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   assert.deepEqual(await page.evaluate(()=>window.__dashboardAiCalls),[])
   const settings=page.locator('details').filter({hasText:'Summary settings'}).first()
   assert.equal(await settings.getAttribute('open'),null)
   await settings.locator('summary').click()
   await settings.locator('select').selectOption('90')
   assert.equal(await card.getByRole('list',{name:'To-do list',exact:true}).textContent(),tasks)
   await settings.locator('summary').click()
  }
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/'+(before?'before':'after')+'-'+width+'.png',fullPage:true})
  report.push({width,...metrics,overflow:false})
 }
 assert.deepEqual(errors,[])
 await writeFile(out+'/'+(before?'before':'after')+'.json',JSON.stringify({report,runtime_errors:errors},null,2))
 console.log(JSON.stringify({report,runtime_errors:errors}))
}finally{await browser.close()}
