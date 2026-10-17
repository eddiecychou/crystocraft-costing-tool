import {build} from 'esbuild'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {pdNavigationFixture} from './pd-navigation-fixture.mjs'
const out='/private/tmp/oc-pd-navigation-preview';await mkdir(out,{recursive:true})
await build({entryPoints:['qa/pd-navigation-preview.jsx'],outfile:out+'/app.js',bundle:true,jsx:'automatic',plugins:[pdNavigationFixture()]})
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
await writeFile(out+'/index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
await writeFile(out+'/audit.html',await readFile('qa/pd-navigation-audit.html','utf8'))
if(!process.argv.includes('--build-only'))createServer(async(req,res)=>{const file=req.url==='/audit'?'audit.html':req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(out+'/'+file))}).listen(5200,'127.0.0.1',()=>console.log('Read-only navigation fixture at http://127.0.0.1:5200/audit'))
