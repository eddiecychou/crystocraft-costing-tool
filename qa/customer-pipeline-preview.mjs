import {build} from 'esbuild'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
const out='/private/tmp/customer-pipeline-preview'
await mkdir(out,{recursive:true})
await build({entryPoints:['qa/customer-pipeline-preview.jsx'],outfile:out+'/app.js',bundle:true,jsx:'automatic',plugins:[{name:'no-live-api',setup(b){b.onResolve({filter:/domain\/customerPipeline$/},()=>({path:'api',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function savePipelineDecision(){throw Error("No live writes")};export async function suggestCustomerPipeline(){return 0}',loader:'js'}))}}]})
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
await writeFile(out+'/index.html','<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>')
await writeFile(out+'/mobile.html','<!doctype html><title>375px Pipeline QA</title><iframe title="Mobile Pipeline" src="/" style="width:375px;height:1000px;border:1px solid #ddd"></iframe>')
createServer(async(req,res)=>{try{const name=({'/':'index.html','/mobile.html':'mobile.html','/style.css':'style.css','/app.js':'app.js'})[req.url];if(!name){res.writeHead(404);res.end();return}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(out+'/'+name))}catch{res.writeHead(500);res.end()}}).listen(5191,'127.0.0.1',()=>console.log('Fictional Pipeline UI at http://127.0.0.1:5191'))
