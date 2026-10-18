// Optional transport for the existing read-only config probe when Node's HTTPS
// connection times out on this Mac. Validation and probe payload are unchanged.
// Usage: node --import ./qa/curl-release-probe-transport.mjs scripts/verify-deployed-login.mjs HTTPS_URL
import {execFileSync} from 'node:child_process'
globalThis.fetch=async (input,options={})=>{
 const url=new URL(input)
 if(url.protocol!=='https:' || !(['portal.crystocraft.com','identitytoolkit.googleapis.com'].includes(url.hostname)||url.hostname.endsWith('--ua-product-manager.netlify.app')))throw Error('Unexpected release probe host.')
 const quote=s=>'"'+String(s).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n').replaceAll('\r','\\r')+'"'
 const config=[`url = ${quote(url.href)}`,`request = ${quote(options.method||'GET')}`]
 for(const [key,value] of Object.entries(options.headers||{}))config.push(`header = ${quote(key+': '+value)}`)
 if(options.body)config.push(`data = ${quote(options.body)}`)
 const output=execFileSync('curl',['-sS','--max-time','30','--config','-','--write-out','\n%{http_code}'],{input:config.join('\n')+'\n',encoding:'utf8',maxBuffer:12*1024*1024})
 const split=output.lastIndexOf('\n'),status=Number(output.slice(split+1))
 if(!status)throw Error('Release probe could not reach the server.')
 return new Response(output.slice(0,split),{status})
}
