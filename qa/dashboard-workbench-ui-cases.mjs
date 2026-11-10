// Geometry and interaction audit of the real Dashboard and real OC Layout.
// Called only against the fictional localhost browser fixture.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
export async function auditWorkbenchUi(page,browser) {
  assert.equal(new URL(page.url()).hostname,'127.0.0.1')
  const out='qa/out/dashboard-ui-polish';await mkdir(out,{recursive:true})
  const results=[]
  for(const width of [1440,1280,1024,768,390,375,320]){
    await page.setViewportSize({width,height:900})
    await page.evaluate(async()=>{document.querySelector('#main-scroll').scrollTo(0,0);await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})
    const metrics=await page.evaluate(()=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},style=e=>{const s=getComputedStyle(e);return {font:s.fontFamily,size:s.fontSize,weight:s.fontWeight}}
      const root=document.querySelector('.dashboard-workbench'),complete=root.querySelector('[aria-label^="Complete task:"]'),text=complete.nextElementSibling,mark=complete.querySelector('.task-complete-mark')
      return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,mainOverflow:document.querySelector('#main-scroll').scrollWidth>document.querySelector('#main-scroll').clientWidth,
        hit:rect(complete),mark:rect(mark),text:rect(text),search:rect(root.querySelector('input[type=search]')),searchStyle:style(root.querySelector('input[type=search]')),category:rect(root.querySelector('#dashboard-customer-category')),review:rect(root.querySelector('#dashboard-contact-review')),filterStyle:style(root.querySelector('[data-task-filter=all]')),headingStyle:style(root.querySelector('h1')),
        filterRows:[...root.querySelectorAll('[data-task-filter]')].map(rect),stageColumns:[...root.querySelectorAll('.dashboard-work-stages')].map(e=>rect(e).x),countColumns:[...root.querySelectorAll('.dashboard-task-count')].map(e=>rect(e).right)}
    })
    assert.equal(metrics.overflow,false);assert.equal(metrics.mainOverflow,false)
    assert.equal(metrics.mark.width,20);assert.equal(metrics.mark.height,20)
    assert.ok(metrics.hit.width>=44&&metrics.hit.height>=44)
    assert.ok(metrics.hit.right<=metrics.text.x,'Completion and edit tap targets must not overlap')
    assert.ok(metrics.search.width>=200,`Search must remain usable at ${width}px, measured ${metrics.search.width}px`)
    assert.ok(metrics.filterRows.every(r=>Math.abs(r.y-metrics.filterRows[0].y)<1),'Three task filters should fit in one row')
    assert.match(metrics.filterStyle.font,/Work Sans/);assert.equal(metrics.headingStyle.weight,'400')
    if(width<768){assert.equal(metrics.searchStyle.size,'16px');assert.ok(metrics.search.height>=44&&metrics.review.height>=44&&metrics.category.height>=44)}
    if(width>=1024){assert.ok(Math.max(...metrics.stageColumns)-Math.min(...metrics.stageColumns)<1);assert.ok(Math.max(...metrics.countColumns)-Math.min(...metrics.countColumns)<1)}
    results.push(metrics)
    await page.screenshot({path:out+`/after-${width}.png`})
    await page.getByRole('button',{name:'Browse all B2B',exact:true}).scrollIntoViewIfNeeded()
    await page.screenshot({path:out+`/after-overview-${width}.png`})
    if(width<768){
      await page.evaluate(()=>{const e=document.querySelector('#main-scroll');e.scrollTop=e.scrollHeight})
      const clearsNav=await page.evaluate(()=>{const bottom=document.querySelector('#main-scroll').lastElementChild.lastElementChild.getBoundingClientRect().bottom;const nav=[...document.querySelectorAll('nav')].find(e=>getComputedStyle(e).position==='fixed'&&e.getBoundingClientRect().height>0);return !nav||bottom<=nav.getBoundingClientRect().top})
      assert.ok(clearsNav,'Dashboard content must clear the fixed bottom navigation')
    }
  }
  // Long company names and task text stay readable without forcing horizontal scrolling.
  const longName='Fictional customer — 客戶公司 '+ 'LongCompanyReference'.repeat(10),longText='Fictional task — 詳細要求 '+ 'LongSpecificationReference'.repeat(35)
  await page.evaluate(({longName,longText})=>{
    const f=globalThis.__dashboardFixture
    f.records['customers/long']={id:'long',company_name:longName}
    f.records['customers/long/work_items/long-task']={kind:'task',text:longText,state:'todo',due_on:'',revision:1}
    for(const cb of f.watchers)cb()
  },{longName,longText})
  for(const width of [1440,375,320]){
    await page.setViewportSize({width,height:800});await page.getByText(longName,{exact:true}).first().waitFor()
    assert.equal(await page.evaluate(()=>document.querySelector('#main-scroll').scrollWidth>document.querySelector('#main-scroll').clientWidth),false)
    const task=page.locator('[aria-label="Outstanding tasks"] li').filter({hasText:longText})
    await task.locator('button').nth(1).scrollIntoViewIfNeeded()
    const geometry=await task.evaluate(el=>({width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right,viewport:innerWidth,titleHeight:el.querySelector('.line-clamp-2').getBoundingClientRect().height}))
    assert.ok(geometry.right<=width+1);assert.ok(geometry.titleHeight<=40.1)
    await task.locator('button').nth(1).click()
    const dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('textbox',{name:'Task',exact:true}).inputValue(),longText)
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.getByRole('button',{name:'Close customer details',exact:true}).click()
  }
  // A short mobile viewport models the available space while a keyboard is open.
  await page.setViewportSize({width:375,height:500})
  await page.getByRole('button',{name:'Browse all B2B',exact:true}).click();await page.getByRole('dialog').locator('select').selectOption('c1')
  let dialog=page.getByRole('dialog')
  for(const name of ['Email & conversation summary','Current work and linked records'])await dialog.locator('summary').filter({hasText:name}).click()
  await dialog.getByRole('button',{name:'Show more'}).click();await dialog.evaluate(e=>e.scrollTop=e.scrollHeight)
  const dialogGeometry=await dialog.evaluate(e=>{const d=e.getBoundingClientRect(),b=e.querySelector('[aria-label="Close customer details"]').getBoundingClientRect();return {height:d.height,viewport:innerHeight,closeWidth:b.width,closeHeight:b.height,closeVisible:b.top>=d.top&&b.bottom<=d.bottom}})
  assert.ok(dialogGeometry.height<=468.1);assert.ok(dialogGeometry.closeVisible);assert.ok(dialogGeometry.closeWidth>=44&&dialogGeometry.closeHeight>=44)
  await page.screenshot({path:out+'/after-dialog-short-mobile.png'})
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
  // Keyboard activation and Escape preserve an unsaved task instead of dismissing it.
  const add=page.getByRole('button',{name:'Add task',exact:true});await add.focus();await page.keyboard.press('Enter')
  dialog=page.getByRole('dialog');await dialog.locator('select').selectOption('c4');dialog=page.getByRole('dialog')
  await dialog.getByRole('textbox',{name:'Task',exact:true}).fill('Fictional keyboard draft')
  assert.equal(await dialog.getByRole('textbox',{name:'Task',exact:true}).evaluate(e=>getComputedStyle(e).fontSize),'16px')
  await page.evaluate(()=>{globalThis.__dashboardFixture.rejectWrites=true})
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Fictional save conflict'}).waitFor()
  assert.equal(await dialog.getByRole('textbox',{name:'Task',exact:true}).inputValue(),'Fictional keyboard draft')
  await page.evaluate(()=>{globalThis.__dashboardFixture.rejectWrites=false})
  await page.keyboard.press('Escape')
  const keep=dialog.getByRole('button',{name:'Keep editing',exact:true}),keepBox=await keep.boundingBox(),dialogBox=await dialog.boundingBox()
  assert.ok(keepBox.y>=dialogBox.y&&keepBox.y+keepBox.height<=dialogBox.y+dialogBox.height,'The unsaved-draft choice must be visible without scrolling')
  await keep.click()
  assert.equal(await dialog.getByRole('textbox',{name:'Task',exact:true}).inputValue(),'Fictional keyboard draft')
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
  // Empty states and failed saves are distinct, preserve drafts, and never hide task access.
  await page.locator('[data-task-filter=all]').click();await page.getByLabel('Find B2B customer',{exact:true}).fill('Fictional no-match search')
  await page.getByText('No outstanding B2B tasks.',{exact:true}).waitFor();await page.getByRole('button',{name:'Show all B2B',exact:true}).click()
  // Touching the outer hit area (outside the 20px mark) must still complete exactly once.
  const touch=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true})
  try{
    const mobile=await touch.newPage();await mobile.goto(page.url());const button=mobile.getByRole('button',{name:'Complete task: Confirm the revised sample colour',exact:true});await button.waitFor();await button.tap({position:{x:4,y:22}})
    await button.waitFor({state:'detached'});const record=await mobile.evaluate(()=>globalThis.__dashboardFixture.records['customers/c1/work_items/past']);assert.equal(record.state,'done');assert.equal(record.revision,2)
    assert.equal(await mobile.getByRole('dialog').count(),0)
  }finally{await touch.close()}
  await page.evaluate(()=>{delete globalThis.__dashboardFixture.records['customers/long'];delete globalThis.__dashboardFixture.records['customers/long/work_items/long-task'];for(const cb of globalThis.__dashboardFixture.watchers)cb()})
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.querySelector('#main-scroll').scrollTo(0,0))
  const report={viewports:results,dialog:dialogGeometry,checks:['20px visual mark / 44px hit target','non-overlapping completion/edit targets','usable search','mobile 16px controls','one-row task filters','desktop aligned columns','bottom navigation clearance','long English/Chinese content','full editor text','sticky dialog close','keyboard Enter/Escape draft protection','empty state','failed save retains draft','touch completion exactly once']}
  await writeFile(out+'/ui-results.json',JSON.stringify(report,null,2)+'\n')
  return report
}
