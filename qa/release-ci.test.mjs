import {test, before, after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, readFile, mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFileSync, spawnSync} from 'node:child_process'
import {REPOSITORY, REQUIRED_JOBS, checkReleaseCi, waitForReleaseCi, releaseCommit} from '../scripts/check-release-ci.mjs'
const sha='a'.repeat(40), run=(change={})=>({id:1002,run_attempt:1,head_sha:sha,path:'.github/workflows/product-search.yml',head_repository:{full_name:REPOSITORY},event:'push',status:'completed',conclusion:'success',...change})
const jobs=()=>REQUIRED_JOBS.map(name=>({name,status:'completed',conclusion:'success',head_sha:sha,run_id:1002}))
function api({runs=[run()],rows=jobs(),total=rows.length}={}) {
 const calls=[]
 const fetchImpl=async(url,options)=>{assert.ok(url.startsWith('https://api.github.com/repos/'+REPOSITORY+'/'));assert.equal(options.redirect,'error');calls.push(url);return Response.json(url.includes('/jobs?')?{jobs:rows,total_count:total}:{workflow_runs:runs,total_count:runs.length})}
 return {fetchImpl,calls,token:''}
}
test('both successful jobs from the exact SHA and workflow attempt pass',async()=>{
 const fake=api(),r=await checkReleaseCi(sha,fake);assert.equal(r.state,'passed');assert.deepEqual(r.jobs,REQUIRED_JOBS);assert.equal(r.sha,sha);assert.ok(fake.calls[0].includes('head_sha='+sha));assert.ok(fake.calls[1].includes('/attempts/1/jobs'))
})
for(const status of ['queued','in_progress','waiting','requested','pending'])test(`unfinished workflow ${status} blocks`,async()=>{
 const r=await checkReleaseCi(sha,api({runs:[run({status,conclusion:null})]}));assert.equal(r.state,'pending')
})
for(const conclusion of ['failure','cancelled','timed_out','skipped','neutral','action_required',null])test(`workflow conclusion ${conclusion} blocks`,async()=>{
 await assert.rejects(checkReleaseCi(sha,api({runs:[run({conclusion})]})),/Deployment blocked/)
})
for(const name of REQUIRED_JOBS)for(const conclusion of ['failure','cancelled','skipped','neutral',null])test(`${name} must explicitly succeed (${conclusion})`,async()=>{
 const rows=jobs().map(j=>j.name===name?{...j,conclusion}:j);await assert.rejects(checkReleaseCi(sha,api({rows})),/Required GitHub job/)
})
test('missing run, another SHA, another workflow, fork and unsupported event cannot satisfy the gate',async()=>{
 for(const runs of [[],[run({head_sha:'b'.repeat(40)})],[run({path:'.github/workflows/other.yml'})],[run({head_repository:{full_name:'fork/repo'}})],[run({event:'workflow_run'})]])assert.equal((await checkReleaseCi(sha,api({runs}))).state,'pending')
})
test('an older success never overrides a newer pending or failed run',async()=>{
 const old=run({id:1001});assert.equal((await checkReleaseCi(sha,api({runs:[old,run({status:'in_progress',conclusion:null})]}))).state,'pending');await assert.rejects(checkReleaseCi(sha,api({runs:[old,run({conclusion:'failure'})]})),/is failure/)
})
test('missing/duplicate jobs, incomplete pages, another SHA or run, and unfinished jobs block',async()=>{
 for(const rows of [jobs().slice(0,1),[...jobs(),jobs()[0]],jobs().map(j=>({...j,head_sha:'b'.repeat(40)})),jobs().map(j=>({...j,run_id:1001})),jobs().map(j=>({...j,status:'in_progress'}))])await assert.rejects(checkReleaseCi(sha,api({rows})),/Required GitHub job/)
 await assert.rejects(checkReleaseCi(sha,api({total:3})),/Incomplete workflow job/)
})
test('a workflow path qualified by its Git ref still identifies the required workflow',async()=>{
 assert.equal((await checkReleaseCi(sha,api({runs:[run({path:'.github/workflows/product-search.yml@refs/heads/main'})]}))).state,'passed')
})
test('reruns read the current attempt rather than the old attempt job list',async()=>{
 const fake=api({runs:[run({run_attempt:2})]});assert.equal((await checkReleaseCi(sha,fake)).attempt,2);assert.ok(fake.calls[1].includes('/attempts/2/jobs'))
})
test('malformed workflow identity, response and SHA block',async()=>{
 await assert.rejects(checkReleaseCi('main',api()),/full lowercase commit SHA/)
 await assert.rejects(checkReleaseCi(sha,api({runs:[run({run_attempt:0})]})),/Invalid workflow identity/)
 await assert.rejects(checkReleaseCi(sha,{fetchImpl:async()=>Response.json({}),token:''}),/latest workflow/)
 await assert.rejects(checkReleaseCi(sha,{fetchImpl:async()=>new Response('invalid'),token:''}),/invalid CI response/)
})
for(const status of [403,404,429,500,503])test(`GitHub HTTP ${status} blocks without printing response or credentials`,async()=>{
 await assert.rejects(checkReleaseCi(sha,{token:'private-fixture-token',fetchImpl:async()=>new Response('private-fixture-token',{status})}),error=>/Deployment blocked/.test(error.message)&&!error.message.includes('private-fixture-token'))
})
test('network outage blocks instead of allowing deployment',async()=>{
 await assert.rejects(checkReleaseCi(sha,{fetchImpl:async()=>{throw Error('private-response')},token:''}),/Cannot reach GitHub.*Deployment blocked/)
})
test('waiting passes only once both jobs succeed',async()=>{
 let n=0,time=0,pending=0;const fake=api();const fetchImpl=(url,options)=>url.includes('/runs?')&&++n===1?Promise.resolve(Response.json({workflow_runs:[run({status:'in_progress',conclusion:null})],total_count:1})):fake.fetchImpl(url,options)
 assert.equal((await waitForReleaseCi(sha,{fetchImpl,token:'',wait:true,timeoutMs:50,intervalMs:10,now:()=>time,sleep:async n=>{time+=n},onPending:()=>pending++})).state,'passed');assert.equal(time,10);assert.equal(pending,1)
})
test('no-wait and timeout paths block; known failure never waits',async()=>{
 const fake=api({runs:[]});await assert.rejects(waitForReleaseCi(sha,fake),/Both required jobs must pass/)
 let time=0;await assert.rejects(waitForReleaseCi(sha,{...fake,wait:true,timeoutMs:30,intervalMs:10,now:()=>time,sleep:async n=>{time+=n}}),/Both required jobs must pass/);assert.equal(time,30)
 await assert.rejects(waitForReleaseCi(sha,{...api({runs:[run({conclusion:'failure'})]}),wait:true,sleep:async()=>assert.fail('Do not wait for failed CI')}),/is failure/)
})
let scratch,repo,head,checker
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'oc-release-ci-'));repo=join(scratch,'repo');await mkdir(join(repo,'scripts'),{recursive:true});checker=resolve('scripts/check-release-ci.mjs');await writeFile(join(repo,'scripts/check-release-ci.mjs'),await readFile(checker));execFileSync('git',['init','-q'],{cwd:repo});execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['-c','user.name=CI fixture','-c','user.email=ci@example.invalid','commit','-qm','fixture'],{cwd:repo});head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()
})
after(async()=>{await rm(scratch,{recursive:true,force:true})})
test('CLI binds clean checkout to Netlify COMMIT_REF and rejects dirty or uncommitted files',async()=>{
 assert.equal(releaseCommit({cwd:repo,env:{NETLIFY:'true',COMMIT_REF:head}}),head);assert.throws(()=>releaseCommit({cwd:repo,env:{NETLIFY:'true'}}),/COMMIT_REF is missing/);assert.throws(()=>releaseCommit({cwd:repo,env:{COMMIT_REF:sha}}),/does not match/)
 const extra=join(repo,'uncommitted');await writeFile(extra,'new');assert.throws(()=>releaseCommit({cwd:repo,env:{}}),/clean, committed/);await rm(extra)
 const path=join(repo,'scripts/check-release-ci.mjs'),body=await readFile(path,'utf8');await writeFile(path,body+'\n// dirty\n');assert.throws(()=>releaseCommit({cwd:repo,env:{}}),/clean, committed/);await writeFile(path,body)
})
test('actual Netlify build command cannot reach build after failed CI, but can after both jobs pass',async()=>{
 const command=(await readFile('netlify.toml','utf8')).match(/^\s*command = "([^"]+)"/m)[1],bin=join(scratch,'bin'),marker=join(scratch,'built'),mock=join(scratch,'mock.mjs');await mkdir(bin)
 await writeFile(mock,`import fs from 'node:fs';import{execFileSync}from'node:child_process';let changed=false;globalThis.fetch=async url=>{if(!changed&&process.env.MOCK_DIRTY){changed=true;fs.writeFileSync('changed-while-checking','dirty')}if(!changed&&process.env.MOCK_MOVE){changed=true;execFileSync('git',['-c','user.name=CI fixture','-c','user.email=ci@example.invalid','commit','--allow-empty','-qm','Moved while checking'])}const sha=process.env.MOCK_SHA,run={id:1002,run_attempt:1,head_sha:sha,path:'.github/workflows/product-search.yml',head_repository:{full_name:'${REPOSITORY}'},event:'push',status:'completed',conclusion:process.env.MOCK_CI};return Response.json(url.includes('/jobs?')?{total_count:2,jobs:${JSON.stringify(REQUIRED_JOBS)}.map(name=>({name,status:'completed',conclusion:'success',head_sha:sha,run_id:1002}))}:{total_count:1,workflow_runs:[run]})}`)
 await writeFile(join(bin,'npm'),`#!/usr/bin/env node\nconst{spawnSync}=require('node:child_process'),fs=require('node:fs');if(process.argv[3]==='release:ci'){const r=spawnSync(process.execPath,['scripts/check-release-ci.mjs','--wait'],{stdio:'inherit',env:process.env});process.exit(r.status??1)}if(process.argv[3]==='build'){fs.writeFileSync(process.env.BUILD_MARKER,'built');process.exit(0)}process.exit(9)`,{mode:0o755})
 const env={...process.env,PATH:bin+':'+process.env.PATH,NODE_OPTIONS:'--import '+pathToFileURL(mock),NETLIFY:'true',COMMIT_REF:head,GITHUB_TOKEN:'',MOCK_SHA:head,BUILD_MARKER:marker}
 const failed=spawnSync('/bin/sh',['-c',command],{cwd:repo,env:{...env,MOCK_CI:'failure'},encoding:'utf8',timeout:10000});assert.notEqual(failed.status,0);assert.match(failed.stderr,/Deployment blocked/);await assert.rejects(readFile(marker),{code:'ENOENT'})
 const dirty=spawnSync('/bin/sh',['-c',command],{cwd:repo,env:{...env,MOCK_CI:'success',MOCK_DIRTY:'true'},encoding:'utf8',timeout:10000});assert.notEqual(dirty.status,0);assert.match(dirty.stderr,/clean, committed/);await assert.rejects(readFile(marker),{code:'ENOENT'});await rm(join(repo,'changed-while-checking'))
 const passed=spawnSync('/bin/sh',['-c',command],{cwd:repo,env:{...env,MOCK_CI:'success'},encoding:'utf8',timeout:10000});assert.equal(passed.status,0,passed.stderr);assert.equal(await readFile(marker,'utf8'),'built')
})

test('a clean HEAD change while waiting also blocks release',async()=>{
 const mock=join(scratch,'mock.mjs');const env={...process.env,NODE_OPTIONS:'--import '+pathToFileURL(mock),NETLIFY:'',COMMIT_REF:'',GITHUB_TOKEN:'',MOCK_SHA:head,MOCK_CI:'success',MOCK_MOVE:'true'}
 const result=spawnSync(process.execPath,['scripts/check-release-ci.mjs'],{cwd:repo,env,encoding:'utf8',timeout:10000});assert.notEqual(result.status,0);assert.match(result.stderr,/Checkout changed while waiting/)
})
