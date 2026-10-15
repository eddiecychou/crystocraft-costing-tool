import {build} from 'esbuild'
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const root=process.cwd(),dir=mkdtempSync(join(tmpdir(),'carousel-response-'))
const before=execFileSync('git',['show',`${process.env.CAROUSEL_BASE_REF || 'e7713ec0'}:src/components/CardImageCarousel.jsx`],{encoding:'utf8'})
for(const variant of ['before','after']){
 await build({entryPoints:['qa/carousel-response-preview.jsx'],outfile:join(dir,variant+'.js'),bundle:true,jsx:'automatic',plugins:[{name:'carousel-version',setup(b){
 b.onResolve({filter:/^QA_CAROUSEL$/},()=>({path:variant,namespace:'qa-version'}));
 b.onLoad({filter:/.*/,namespace:'qa-version'},()=>({contents:variant==='before'?before:readFileSync('src/components/CardImageCarousel.jsx','utf8'),resolveDir:join(root,'src/components'),loader:'jsx'}));
 }}]})
 writeFileSync(join(dir,variant+'.html'),`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/${variant}.js"></script>`)
}
execFileSync('./node_modules/.bin/tailwindcss',['-i','src/index.css','-o',join(dir,'style.css')])
const requests=[]
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(url.pathname==='/qa-requests'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(requests));return}
 if(url.pathname==='/.netlify/images'){
  const original=new URL(url.searchParams.get('url'))
  const n=Number(original.pathname.match(/photo-(\d+)/)?.[1]||0)
  const record={run:original.searchParams.get('run'),photo:n,offscreen:original.searchParams.has('offscreen'),width:url.searchParams.get('w'),at:Date.now()};requests.push(record)
  setTimeout(()=>{
   if(original.searchParams.has('broken')){res.writeHead(404);res.end();return}
   res.setHeader('Content-Type','image/svg+xml');res.setHeader('Cache-Control','private, max-age=86400')
   res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="${['#e7d3bd','#ceddc4','#d9cde4','#f1d7c8'][n%4]}"/><text x="320" y="320" text-anchor="middle" font-size="50" font-family="sans-serif">PHOTO ${n+1}</text></svg>`)
  },n===0?40:800);return
 }
 const file={'/before.html':'before.html','/after.html':'after.html','/before.js':'before.js','/after.js':'after.js','/style.css':'style.css'}[url.pathname]
 if(!file){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(dir,file)))
})
const port=Number(process.env.CAROUSEL_QA_PORT || 5187)
server.listen(port,'127.0.0.1',()=>console.log(`Carousel fixture: http://127.0.0.1:${port}/{before,after}.html; ${dir}`))
