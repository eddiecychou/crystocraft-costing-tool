import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { ref, getMetadata, uploadString } from 'firebase/storage'
import { readFileSync } from 'node:fs'
import { createBrandGalleryHandler } from '../netlify/edge-functions/lib/brandGallery.js'
import { galleryUrl, galleryReference } from '../src/brandGalleryUrls.js'
import { imageDownloadUrl } from '../src/imageDownloadUrl.js'

for (const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST']) assert.match(process.env[key] || '', /^(localhost|127\.0\.0\.1):\d+$/)
test('company gallery metadata and original bytes follow current approval, company and file visibility', async () => {
  const env = await initializeTestEnvironment({ projectId:'crystocraft-rbac-test',
    firestore:{rules:readFileSync('firestore.rules','utf8')}, storage:{rules:readFileSync('storage.rules','utf8')} })
  const company = 'qa_gallery_owner', other = 'qa_gallery_other', filename = '虛構 logo.svg'
  const path = 'customer-assets/'+company+'/art/'+filename, bytes = '<svg xmlns="http://www.w3.org/2000/svg"><title>Fictional gallery</title></svg>'
  const profiles = {
    owner:{role:'customer',status:'approved',customer_id:company}, pending:{role:'customer',status:'pending',customer_id:company},
    suspended:{role:'customer',status:'suspended',customer_id:company}, other:{role:'customer',status:'approved',customer_id:other},
    unlinked:{role:'customer',status:'approved'}, crm:{role:'staff',modules:['customers']}, shipping:{role:'staff',modules:['shipping'],customer_id:company},
  }
  const save = (p,data) => env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),p),data))
  const location = 'customers/'+company+'/assets/'
  try {
    for (const [name,profile] of Object.entries(profiles)) await save('users/qa_gallery_'+name, profile)
    for (const [name,visibility] of [['art','customer_private'],['public','public_reference'],['internal','internal_only'],['unknown','typo']]) {
      await save(location+name,{visibility,filename,storage_path:path})
    }
    await env.withSecurityRulesDisabled(c=>uploadString(ref(c.storage(),path),bytes))
    const context = name => profiles[name] ? env.authenticatedContext('qa_gallery_'+name) : env.unauthenticatedContext()
    for (const name of [...Object.keys(profiles),'anonymous']) {
      const c = context(name), db=c.firestore(), allowed=name==='owner'||name==='crm'
      const gate=allowed?assertSucceeds:assertFails
      await gate(getDoc(doc(db,location+'art')))
      await gate(getDoc(doc(db,location+'public')))
      await gate(getDocs(query(collection(db,location.slice(0,-1)),where('visibility','in',['customer_private','public_reference']))))
      for (const privateId of ['internal','unknown']) await (name==='crm'?assertSucceeds:assertFails)(getDoc(doc(db,location+privateId)))
      await assertFails(getMetadata(ref(c.storage(),path)))
    }
    await assertFails(setDoc(doc(context('crm').firestore(),location+'art'),{gallery_original_path:'customer-assets/other/stolen/file'}, {merge:true}))
    let reads=0
    const handler=createBrandGalleryHandler({
      async getProfile(token) {
        const s=await getDoc(doc(context(token).firestore(),'users/qa_gallery_'+token))
        return {...s.data(),company:s.data()?.customer_id}
      },
      async readAsset(co,asset,token) {
        try {
          const s=await getDoc(doc(context(token).firestore(),'customers',co,'assets',asset))
          if(!s.exists())return new Response(null,{status:404})
          return Response.json({fields:Object.fromEntries(Object.entries(s.data()).map(([k,v])=>[k,{stringValue:v}]))})
        } catch {return new Response(null,{status:403})}
      },
      async readObject(p) { reads++;assert.equal(p,path);return new Response(bytes,{headers:{'Content-Type':'image/svg+xml'}}) },
    })
    const link=galleryUrl(company,'art',filename)
    const req=(href,token)=>new Request('https://oc.example'+href,{headers:token?{Authorization:'Bearer '+token}:{}})
    const old='https://firebasestorage.googleapis.com/v0/b/test/o/'+encodeURIComponent(path)+'?alt=media&token=old'
    assert.equal(galleryReference(old,'test'),link)
    for(const name of ['owner','crm']){
      for (const href of [link,imageDownloadUrl(link,filename,true)]) {
        const res=await handler(req(href,name));assert.equal(res.status,200);assert.equal(await res.text(),bytes)
        assert.match(res.headers.get('Cache-Control'),/no-store/)
        assert.match(res.headers.get('Content-Disposition'),href.includes('download=1')?/^attachment/:/^inline/)
      }
    }
    const binding='12345678-abcd-1234-abcd-123456789abc',url='https://oc.example/api/brand-gallery-media'
    const setup=await handler(new Request(url,{method:'POST',headers:{Origin:'https://oc.example',Authorization:'Bearer owner','X-Gallery-Binding':binding}}))
    assert.equal(setup.status,204);assert.match(setup.headers.get('set-cookie'),/HttpOnly/)
    const cookie=setup.headers.get('set-cookie').split(';')[0]+'; oc_gallery_binding='+binding
    const existing=new Request('https://oc.example'+link,{headers:{Cookie:cookie}})
    assert.equal((await handler(existing)).status,200)
    assert.equal((await handler(new Request(existing,{headers:{Cookie:cookie.split(';')[0]}}))).status,401)
    const before=reads
    for(const name of ['pending','suspended','other','unlinked','shipping',null]) {
      for (const href of [link,imageDownloadUrl(link)]) assert.equal((await handler(req(href,name))).status,name?403:401)
    }
    await save('users/qa_gallery_owner',{...profiles.owner,status:'suspended'})
    assert.equal((await handler(existing)).status,403)
    await save('users/qa_gallery_owner',profiles.owner)
    await save(location+'art',{filename,storage_path:path,visibility:'internal_only'})
    assert.equal((await handler(existing)).status,403)
    assert.equal(reads,before)
  } finally {await env.cleanup()}
})
