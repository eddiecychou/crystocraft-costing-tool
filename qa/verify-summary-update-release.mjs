// Fresh real-page role checks; no live task saves or AI regeneration.
import {createRequire} from 'node:module'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const base=process.argv[2]
if(!base?.startsWith('https://'))throw Error('HTTPS candidate/production URL required.')
const require=createRequire(process.cwd()+'/.qa-playwright/package.json'),{chromium}=require('playwright-core')
const secrets=await readFile('.env.local','utf8'),env={}
for(const key of ['QA_ADMIN_EMAIL','QA_ADMIN_PASSWORD','QA_CUSTOMER_EMAIL','QA_CUSTOMER_PASSWORD']){
 const m=secrets.match(new RegExp('^'+key+'=(.*)$','m'));if(!m)throw Error('Missing authorized QA credential: '+key)
 env[key]=m[1].trim().replace(/^(['"])(.*)\1$/,'$2')
}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-quic']}),out='qa/out/summary-update-release',report={url:base,checked_at:new Date().toISOString(),roles:[]}
await mkdir(out,{recursive:true})
try{
 for(const role of ['ADMIN','CUSTOMER']){
  const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error'&&/permission-denied|FirebaseError|ChunkLoadError|Failed to fetch dynamically imported/.test(m.text()))errors.push(m.text())})
  const go=async path=>{for(let n=0;n<2;n++){try{return await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000})}catch(e){if(n||!/net::ERR_/.test(e.message))throw e}}}
  await go('/login');await page.locator('input[type=email]').fill(env['QA_'+role+'_EMAIL']);await page.locator('input[type=password]').fill(env['QA_'+role+'_PASSWORD']);await page.locator('form button[type=submit]').click()
  await page.waitForURL(u=>u.pathname!=='/login',{timeout:60000})
  assert.ok(new URL(page.url()).pathname.startsWith(role==='ADMIN'?'/dashboard':'/shop'))
  console.log(role,'fresh password sign-in PASS')
  const result={role:role.toLowerCase(),fresh_login:'PASS',routing:'PASS',access_separation:'PASS',refresh:'PASS'}
  if(role==='ADMIN'){
   await page.getByRole('heading',{name:'Customer to-do list',exact:true}).waitFor({timeout:60000})
   assert.ok(await page.locator('a[href="/settings"]').count()>0);assert.ok(await page.locator('a[href="/portal"]').count()>0)
   const cards=page.locator('section[aria-label^="Summary and to-do"]')
   await cards.first().waitFor({timeout:60000})
   await page.getByText('Loading summaries and tasks…',{exact:true}).waitFor({state:'hidden',timeout:60000})
   const layout=await cards.evaluateAll(els=>els.map(el=>{
    const task=el.querySelector('ul[aria-label="To-do list"]'),summary=el.querySelector('section[aria-label="Email and conversation summary"]'),preview=summary?.querySelector('p[id]')
    return {openTasks:task.children.length,actionsBeforeContext:!!(task.compareDocumentPosition(summary)&4),previewCharacters:Array.from(preview?.textContent||'').length}
   }))
   assert.ok(layout.every(x=>x.actionsBeforeContext&&x.previewCharacters<=201));result.customer_cards=layout.length
   let sawContextOnly=false;for(const entry of layout){if(!entry.openTasks)sawContextOnly=true;else assert.equal(sawContextOnly,false,'Customer actions must precede context-only cards')}
   const expandable=cards.filter({has:page.getByRole('button',{name:'Read full summary',exact:true})}).first()
   await expandable.waitFor({timeout:60000})
   const referenceHref=await expandable.locator('a[href^="/customers/"]').first().getAttribute('href')
   // Bind identity before the toggle changes its label; do not select another card.
   const expanded=cards.filter({has:page.locator('a[href="'+referenceHref+'"]')}).first()
   const taskText=await expanded.getByRole('list',{name:'To-do list',exact:true}).textContent()
   await expanded.getByRole('button',{name:'Read full summary',exact:true}).click()
   assert.ok(Array.from(await expanded.locator('p[id]').textContent()).length>200)
   assert.equal(await expanded.getByRole('list',{name:'To-do list',exact:true}).textContent(),taskText)
   await expanded.getByRole('button',{name:'Add task',exact:true}).click()
   await expanded.getByLabel('Task',{exact:true}).waitFor();await expanded.getByRole('button',{name:'Cancel',exact:true}).click()
   await expanded.getByRole('button',{name:'Show less',exact:true}).click()
   const settings=page.locator('details').filter({hasText:'Summary settings'}).first()
   assert.equal(await settings.getAttribute('open'),null)
   await settings.locator('summary').click();assert.ok(await settings.getByRole('button',{name:'Update AI summaries',exact:true}).isEnabled());assert.equal(await page.getByRole('status').count(),0)
   await settings.locator('summary').click()
   for(const width of [320,375,414,1280]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(250)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await cards.first().scrollIntoViewIfNeeded()
    if(width===375||width===1280)await page.screenshot({path:out+'/admin-'+width+'-'+new URL(base).hostname+'.png',fullPage:true})
   }
   await page.reload();await page.getByRole('heading',{name:'Customer to-do list',exact:true}).waitFor()
   await cards.first().waitFor({timeout:60000})
   const customerLink=cards.first().locator('a[href^="/customers/"]').first()
   await customerLink.click();await page.waitForURL(u=>u.pathname.startsWith('/customers/'),{timeout:60000})
   await page.getByRole('heading',{name:'Customer to-do',exact:true}).waitFor({timeout:60000})
   const detail=page.locator('section[aria-label^="Summary and to-do"]').first()
   await detail.waitFor({timeout:60000})
   await detail.getByRole('button',{name:'Add note',exact:true}).click();await detail.getByLabel('Reference note',{exact:true}).waitFor();await detail.getByRole('button',{name:'Cancel',exact:true}).click()
   await page.reload();await detail.waitFor({timeout:60000})
   await go('/products');await page.getByRole('heading',{name:'Products',exact:true}).waitFor()
   await page.locator('a[href^="/products/"]').filter({has:page.locator('img')}).first().waitFor({timeout:60000})
   Object.assign(result,{summary_idle_control_without_generation:'PASS',task_first_and_short_preview:'PASS',summary_review_and_manual_task_editor:'PASS',customer_record:'PASS',catalogue:'PASS',widths:[320,375,414,1280]})
  }else{
   await go('/shop/figurine');await page.getByRole('heading',{name:'Crystocraft Range',exact:true}).waitFor()
   const product=page.locator('a[href^="/shop/figurine/"]').first();await product.waitFor({timeout:60000});await product.click();await page.locator('h1').waitFor()
   assert.equal(await page.locator('a[href="/settings"]').count(),0)
   assert.equal(await page.locator('section[aria-label^="Summary and to-do"]').count(),0)
   await page.reload();await page.locator('h1').waitFor()
   await go('/dashboard');await page.waitForURL(u=>u.pathname.startsWith('/shop'),{timeout:30000})
   assert.equal(await page.getByRole('heading',{name:'Customer to-do list',exact:true}).count(),0)
   await page.screenshot({path:out+'/customer-'+new URL(base).hostname+'.png',fullPage:true})
   Object.assign(result,{catalogue_and_detail:'PASS',internal_dashboard_refused:'PASS'})
  }
  assert.deepEqual(errors,[]);result.runtime_errors=errors;report.roles.push(result)
  console.log(role,'data, separation, refresh and feature checks PASS');await context.close()
 }
 await writeFile(out+'/release-'+new URL(base).hostname+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{await browser.close()}
