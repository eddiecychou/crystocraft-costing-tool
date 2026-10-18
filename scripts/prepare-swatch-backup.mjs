// Read-only source export + local archive preparation. Never writes Firebase.
// Usage: node scripts/prepare-swatch-backup.mjs /private/tmp/PRIVATE-DIR
// Fly's HTTPS exec has a 10 MB output limit; bounded chunks avoid SSH sleep/
// transport failures. Only a scratch archive under Fly /tmp is created.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
const target=process.argv[2]
if(!target || !target.startsWith('/private/tmp/'))throw Error('Use a private /private/tmp export directory.')
mkdirSync(target,{recursive:true,mode:0o700})
const fly=join(process.env.HOME,'.fly/bin/flyctl')
function remote(py) {
  const command='python -c '+"'"+py.replaceAll("'","'\\''")+"'"
  const result=JSON.parse(execFileSync(fly,['machine','exec','0805d72a9d3778','-a','crystocraft-customizer-render','--timeout','60','--json',command],{encoding:'utf8',maxBuffer:10*1024*1024,timeout:90000}))
  if((result.exit_code??0)!==0 || typeof result.stdout!=='string')throw Error('Fly backup command failed: '+result.stderr)
  return result.stdout || ''
}
const inventoryCode='import pathlib,hashlib,json; print(json.dumps({str(p.relative_to("/data")):{"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(pathlib.Path("/data").rglob("*")) if p.is_file()}))'
const start=JSON.parse(remote(inventoryCode))
const archive='/tmp/swatches-v819.tar.gz'
const size=Number(remote(`import tarfile,os; t=tarfile.open("${archive}","w:gz");t.add("/data",arcname="data");t.close();print(os.path.getsize("${archive}"))`))
const chunks=[], chunkSize=512*1024
for(let offset=0;offset<size;offset+=chunkSize) {
  const output=remote(`import base64; f=open("${archive}","rb");f.seek(${offset});print(base64.b64encode(f.read(${chunkSize})).decode())`)
  chunks.push(Buffer.from(output.trim(),'base64'));console.log('Downloaded backup bytes',Math.min(offset+chunkSize,size),'/',size)
}
const compressed=Buffer.concat(chunks)
if(compressed.length!==size)throw Error('Incomplete archive download.')
const tarPath=join(target,'source.tar.gz');writeFileSync(tarPath,compressed,{mode:0o600})
const end=JSON.parse(remote(inventoryCode))
if(JSON.stringify(start)!==JSON.stringify(end))throw Error('Source changed during export. Retry a fresh backup.')
writeFileSync(join(target,'source-inventory.json'),JSON.stringify(start,null,2),{mode:0o600})
// Refuse unsafe member paths before extracting the private source archive.
const members=execFileSync('tar',['-tzf',tarPath],{encoding:'utf8'}).trim().split('\n')
if(members.some(p=>p.startsWith('/') || p.split('/').includes('..') || !(p==='data' || p.startsWith('data/'))))throw Error('Unsafe archive path.')
execFileSync('tar',['-xzf',tarPath,'-C',target])
const hash=b=>createHash('sha256').update(b).digest('hex')
const zip=new JSZip()
for(const [path,item] of Object.entries(start)) {
  const bytes=readFileSync(join(target,'data',path))
  if(bytes.length!==item.bytes || hash(bytes)!==item.sha256)throw Error('Backup mismatch: '+path)
  zip.file('data/'+path,bytes)
}
const registryHash=start['colors/registry.json']?.sha256
if(!registryHash)throw Error('Source registry missing.')
const manifest={schema_version:1,source_app:'crystocraft-customizer-render',source_inventory:start,registry_sha256:registryHash}
zip.file('migration-manifest.json',JSON.stringify(manifest))
writeFileSync(join(target,'swatch-migration.zip'),await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),{mode:0o600})
console.log(JSON.stringify({files:Object.keys(start).length,archive_bytes:size,registry_sha256:registryHash,zip:join(target,'swatch-migration.zip'),archive_sha256:hash(compressed)}))
