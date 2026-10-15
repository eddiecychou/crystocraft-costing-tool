import {build} from 'esbuild'
import {fixtureSource} from './marketing-copy-fixture.mjs'
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync,spawn} from 'node:child_process'
import {createServer} from 'node:http'
const dir=mkdtempSync(join(tmpdir(),'marketing-copy-qa-'))
await build({entryPoints:['qa/marketing-copy-preview.jsx'],bundle:true,outfile:join(dir,'app.js'),jsx:'automatic',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^(firebase\/firestore|\.\/firebase)$/},()=>({path:'fixture',namespace:'fixture'}));
 b.onResolve({filter:/\/access$/},()=>({path:'access',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='access'?`export const useRole=()=> 'admin'`:fixtureSource,loader:'js'}))
}}]})
execFileSync('./node_modules/.bin/tailwindcss',['-i','src/index.css','-o',join(dir,'style.css')])
writeFileSync(join(dir,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>')
const server=createServer((req,res)=>{if(req.url.startsWith('/?width=')){const width=Number(req.url.split('=')[1]);res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{margin:0}</style><iframe style="border:0;width:'+width+'px;height:1800px" src="/"></iframe><script>onmessage=e=>{const p=document.createElement("pre");p.id="qa-results";p.style.display="none";p.textContent=JSON.stringify(e.data);document.body.append(p)}</script>');return}const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[req.url];if(!file){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(dir,file)))})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
try {
 for(const width of [375,1280]) {
 const screenshot=join(dir,`review-${width}.png`)
 const output=await new Promise((resolve,reject)=>{const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-sandbox','--disable-gpu',`--user-data-dir=${join(dir,'profile-'+width)}`,`--window-size=1280,1800`,'--virtual-time-budget=30000',`--screenshot=${screenshot}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/?width=${width}`]);let data='';child.stdout.on('data',d=>data+=d);child.stderr.resume();child.on('error',reject);child.on('exit',code=>code?reject(Error('Chrome exit '+code)):resolve(data))})
 const match=output.match(/<pre id="qa-results"[^>]*>(.*?)<\/pre>/s)
 if(!match){writeFileSync(join(dir,'unfinished.html'),output);throw Error('Browser did not finish checks: '+dir)}
 const checks=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'))
 console.log(JSON.stringify({width,checks,screenshot}))
 if(checks.some(c=>!c.ok))process.exitCode=1
 }
} finally {server.close()}
