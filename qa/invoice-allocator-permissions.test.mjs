// Real PostgreSQL 17 in memory; no network/database credentials or live numbers.
// Gateway/client logic stays real; only JWT/profile/REST transport is fictional.
import {test,before,after,beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {PGlite} from '@electric-sql/pglite'

const setup=await readFile('erp-sync/app_sales_invoice.sql','utf8')
const migration=await readFile('erp-sync/migrations/20261107180016_harden_sales_invoice_execute.sql','utf8')
const signature='public.allocate_sales_invoice(text,text,text,text,bigint,text,text)'
const params=['26','FICTIONAL allocator QA','USD','fictional-order',null,null,'fictional@example.invalid']
const prerequisites=`create schema raw;
 create table raw.salesinvoice(sino text);
 create sequence public.fictional_uc_number start 100;
 create table public.uc_registry(id bigserial primary key,
   uc_no text default ('UC'||nextval('public.fictional_uc_number')),year text,
   customer text,currency text,status text,created_by text);`
let db,handler,client,scratch,originalFetch,originalDeno,serverRole='service_role',rpcCalls=[]
const query=async(sql,args)=>(await db.query(sql,args)).rows
const grants=()=>query(`select has_function_privilege('anon','${signature}','EXECUTE') as anon,
 has_function_privilege('authenticated','${signature}','EXECUTE') as authenticated,
 has_function_privilege('service_role','${signature}','EXECUTE') as service`)
const fingerprint=()=>query(`select p.oid,pg_get_functiondef(p.oid) as definition,
 pg_get_userbyid(p.proowner) as owner,p.proconfig,p.prosecdef,p.proacl::text as acl
 from pg_proc p where p.oid='${signature}'::regprocedure`)
const rowsAndSequences=async()=>({
 invoices:await query('select * from public.app_sales_invoice order by id'),
 ucs:await query('select * from public.uc_registry order by id'),
 audits:await query('select * from public.app_sales_invoice_audit order by id'),
 sequences:await query('select schemaname,sequencename,last_value from pg_sequences where schemaname in (\'public\',\'raw\') order by 1,2'),
 tableGrants:await query("select relname,relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','raw') and c.relkind in ('r','S') order by 1"),
 schemaGrants:await query("select nspname,nspacl::text from pg_namespace where nspname in ('public','raw') order by 1"),
})
async function allocate(role,args=params){
 assert.ok(['anon','authenticated','service_role','fictional_unrelated'].includes(role))
 await db.exec(`set role ${role}`)
 try{return await query('select * from public.allocate_sales_invoice($1::text,$2::text,$3::text,$4::text,$5::bigint,$6::text,$7::text)',args)}
 finally{await db.exec('reset role')}
}
const profileFields=token=>token==='FICTIONAL-admin'?{role:{stringValue:'admin'}}:
 token==='FICTIONAL-staff-uc'?{role:{stringValue:'staff'},modules:{arrayValue:{values:[{stringValue:'uc'}]}}}:
 token==='FICTIONAL-customer'?{role:{stringValue:'customer'},modules:{arrayValue:{values:[{stringValue:'uc'}]}}}:
 {role:{stringValue:'staff'},modules:{arrayValue:{values:[{stringValue:'shipping'}]}}}
before(async()=>{
 db=new PGlite();assert.match((await query('select version() as version'))[0].version,/^PostgreSQL 17\./)
 await db.exec('create role anon;create role authenticated;create role service_role;create role fictional_unrelated;')
 scratch=await mkdtemp(join(tmpdir(),'oc-allocator-permissions-'))
 await build({entryPoints:['netlify/edge-functions/uc.js'],bundle:true,platform:'node',format:'esm',outfile:join(scratch,'edge.mjs'),plugins:[{name:'fictional-jwt',setup(b){
   b.onResolve({filter:/^https:\/\/esm.sh\/jose/},()=>({path:'jwt',namespace:'fictional'}))
   b.onLoad({filter:/.*/,namespace:'fictional'},()=>({contents:`export const createRemoteJWKSet=()=>({});export const jwtVerify=async token=>{if(!/^FICTIONAL-(admin|staff-uc|staff-other|customer)$/.test(token))throw Error('Invalid fictional identity');return{payload:{sub:token,email:'fictional@example.invalid'}}};`}))
 }}]})
 handler=(await import(pathToFileURL(join(scratch,'edge.mjs')))).default
 await build({entryPoints:['src/ucRegistry.js'],bundle:true,platform:'node',format:'esm',outfile:join(scratch,'client.mjs'),plugins:[{name:'fictional-auth',setup(b){
   b.onResolve({filter:/^\.\/firebase$/},()=>({path:'firebase',namespace:'fictional'}))
   b.onLoad({filter:/.*/,namespace:'fictional'},()=>({contents:`export const authedUser=async()=>({getIdToken:async()=>'FICTIONAL-admin'});`}))
 }}]})
 client=await import(pathToFileURL(join(scratch,'client.mjs')))
 originalFetch=globalThis.fetch;originalDeno=globalThis.Deno
 globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://fictional-allocator.invalid',SUPABASE_SECRET_KEY:'FICTIONAL-SERVER-KEY',VITE_FIREBASE_PROJECT_ID:'fictional-allocator'}[key])}}
 globalThis.fetch=async(input,init={})=>{
   if(input==='/api/uc')return handler(new Request('https://fictional-app.invalid/api/uc',init))
   const url=new URL(input)
   if(url.origin==='https://firestore.googleapis.com'&&url.pathname.startsWith('/v1/projects/fictional-allocator/databases/(default)/documents/users/FICTIONAL-')&&(!init.method||init.method==='GET'))
     return new Response(JSON.stringify({fields:profileFields(url.pathname.split('/').at(-1))}))
   assert.equal(url.href,'https://fictional-allocator.invalid/rest/v1/rpc/allocate_sales_invoice','No other network operation is permitted')
   assert.equal(init.method,'POST');assert.equal(init.headers.apikey,'FICTIONAL-SERVER-KEY');assert.equal(init.headers.Authorization,'Bearer FICTIONAL-SERVER-KEY')
   const body=JSON.parse(init.body);rpcCalls.push(body)
   try{return new Response(JSON.stringify(await allocate(serverRole,[body.p_year,body.p_customer,body.p_currency,body.p_order_id,body.p_uc_id,body.p_uc_no,body.p_created_by])))}
   catch(e){return new Response(JSON.stringify({code:e.code,message:e.message}),{status:e.code==='42501'?403:400})}
 }
})
beforeEach(async()=>{
 await db.exec('rollback;reset role;revoke service_role from anon;drop schema if exists raw cascade;drop schema public cascade;create schema public;grant usage on schema public to public;')
 await db.exec(prerequisites);await db.exec(setup)
 await db.exec(`insert into raw.salesinvoice values ('SI260042');
 insert into public.uc_registry(uc_no,year,customer,currency,status) values ('UC90','/26','FICTIONAL existing UC','USD','open');
 insert into public.app_sales_invoice(si_no,year,customer,total) values ('SI260045','26','FICTIONAL prior invoice',12.345);
 grant execute on function ${signature} to public;`)
 serverRole='service_role';rpcCalls=[]
})
afterEach(async()=>{await db.exec('rollback;reset role;revoke service_role from anon;')})
after(async()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;await db?.close();if(scratch)await rm(scratch,{recursive:true,force:true})})

test('reproduces inherited PUBLIC execution in PostgreSQL using fictional numbers only',async()=>{
 assert.deepEqual(await grants(),[{anon:true,authenticated:true,service:true}])
 const result=await allocate('anon');assert.equal(result[0].o_si_no,'SI260046')
 assert.equal((await query('select count(*)::int as n from app_sales_invoice'))[0].n,2)
})
test('migration changes only intended grants, preserving definition, owner, OID, data, sequences and table/schema ACLs',async()=>{
 const [before]=await fingerprint(),data=await rowsAndSequences();await db.exec(migration)
 const [after]=await fingerprint();assert.deepEqual({...after,acl:before.acl},before)
 assert.notEqual(after.acl,before.acl);assert.deepEqual(await grants(),[{anon:false,authenticated:false,service:true}])
 assert.deepEqual(await rowsAndSequences(),data)
 assert.equal((await query(`select count(*)::int as n from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='${signature}'::regprocedure and a.grantee=0`))[0].n,0)
})
test('clears explicit anon/authenticated grants as well as inherited PUBLIC access',async()=>{
 await db.exec(`grant execute on function ${signature} to anon,authenticated;`);await db.exec(migration)
 assert.deepEqual(await grants(),[{anon:false,authenticated:false,service:true}])
})
test('anonymous, authenticated and unrelated roles fail before allocation; data and sequences remain unchanged',async()=>{
 await db.exec(migration);const before=await rowsAndSequences()
 for(const role of['anon','authenticated','fictional_unrelated'])await assert.rejects(allocate(role),e=>e.code==='42501')
 assert.deepEqual(await rowsAndSequences(),before)
})
test('service role still allocates against app/mirror maxima without direct raw-schema access',async()=>{
 await db.exec(migration);await db.exec('set role service_role')
 try{await assert.rejects(query('select * from raw.salesinvoice'),e=>e.code==='42501')}finally{await db.exec('reset role')}
 const [row]=await allocate('service_role');assert.equal(row.o_si_no,'SI260046');assert.equal(row.o_uc_no,'UC100/26')
 assert.equal((await query('select count(*)::int as n from app_sales_invoice'))[0].n,2)
 assert.equal((await query('select count(*)::int as n from app_sales_invoice_audit'))[0].n,2)
})
for(const[caseName,args,expectedUc]of[
 ['existing UC ID',['26','FICTIONAL','USD','fictional-order',1,null,'fictional@example.invalid'],'UC90/26'],
 ['existing UC text',['26','FICTIONAL','USD','fictional-order',null,'UC90/26','fictional@example.invalid'],'UC90/26'],
 ['unresolved historical UC text',['26','FICTIONAL','USD','fictional-order',null,'UC-UNKNOWN/26','fictional@example.invalid'],'UC-UNKNOWN/26'],
])test('preserves '+caseName,async()=>{
 await db.exec(migration);const before=(await query('select count(*)::int as n from uc_registry'))[0].n
 const [row]=await allocate('service_role',args);assert.equal(row.o_uc_no,expectedUc)
 assert.equal((await query('select count(*)::int as n from uc_registry'))[0].n,before)
})
test('same order can still deliberately receive distinct invoices; no recovery policy is introduced',async()=>{
 await db.exec(migration);const a=await allocate('service_role'),b=await allocate('service_role')
 assert.notEqual(a[0].o_si_no,b[0].o_si_no)
})
test('reapplying the narrow migration is harmless and does not allocate numbers',async()=>{
 await db.exec(migration);const before=await fingerprint(),data=await rowsAndSequences();await db.exec(migration)
 assert.deepEqual(await fingerprint(),before);assert.deepEqual(await rowsAndSequences(),data)
})
test('unreviewed overload makes the migration stop without changing grants',async()=>{
 await db.exec('create function public.allocate_sales_invoice() returns int language sql as $$select 1$$;')
 const before=await fingerprint();await assert.rejects(db.exec(migration),/inspect overloads first/);await db.exec('rollback;')
 assert.deepEqual(await fingerprint(),before)
})
test('changed security/search-path configuration refuses migration before grant changes',async()=>{
 await db.exec(`alter function ${signature} set search_path=public;`);const before=await fingerprint()
 await assert.rejects(db.exec(migration),/security configuration changed/);await db.exec('rollback;')
 assert.deepEqual(await fingerprint(),before)
})
test('inherited service-role membership fails effective-rights guard and rolls back all ACL changes',async()=>{
 await db.exec('grant service_role to anon;');const before=await fingerprint()
 await assert.rejects(db.exec(migration),/Effective invoice execution grants/);await db.exec('rollback;')
 assert.deepEqual(await fingerprint(),before)
})
test('fresh canonical setup publishes only a private seven-argument allocator',async()=>{
 await db.exec('drop schema raw cascade;drop schema public cascade;create schema public;grant usage on schema public to public;')
 await db.exec(prerequisites);await db.exec(setup)
 assert.deepEqual(await grants(),[{anon:false,authenticated:false,service:true}])
 assert.equal((await query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='allocate_sales_invoice'"))[0].n,1)
})
test('failed final canonical install cannot leave a publicly callable allocator',async()=>{
 await db.exec('drop schema raw cascade;drop schema public cascade;create schema public;grant usage on schema public to public;');await db.exec(prerequisites)
 const last=setup.lastIndexOf('revoke all on function public.allocate_sales_invoice(')
 await assert.rejects(db.exec(setup.slice(0,last)+'select 1/0;\n'+setup.slice(last)),e=>e.code==='22012');await db.exec('rollback;')
 const rows=await query("select has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='allocate_sales_invoice'")
 assert.ok(rows.every(r=>!r.anon&&!r.authenticated))
})
test('legacy UC client and gateway require the protected saved-order workflow without calling SQL',async()=>{
 await db.exec(migration);const before=await rowsAndSequences()
 await assert.rejects(client.allocateInvoice({year:'26',customer:'FICTIONAL gateway QA',order_id:'fictional-order'}),/Refresh OC/)
 assert.equal(rpcCalls.length,0);assert.deepEqual(await rowsAndSequences(),before)
})
test('legacy gateway still enforces UC authorization before its refresh response',async()=>{
 const call=token=>handler(new Request('https://fictional-app.invalid/api/uc',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({op:'allocate_invoice',year:'26'})}))
 for(const token of['FICTIONAL-staff-other','FICTIONAL-customer'])assert.equal((await call(token)).status,403)
 assert.equal((await call('FICTIONAL-staff-uc')).status,409);assert.equal(rpcCalls.length,0)
})
test('legacy allocation is refused even when a server database role is misconfigured',async()=>{
 await db.exec(migration);serverRole='anon';const before=await rowsAndSequences()
 await assert.rejects(client.allocateInvoice({year:'26',customer:'FICTIONAL'}),/Refresh OC/)
 assert.deepEqual(await rowsAndSequences(),before);assert.equal(rpcCalls.length,0)
})
