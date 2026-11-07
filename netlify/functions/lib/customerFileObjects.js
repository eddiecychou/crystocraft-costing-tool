import {createHash} from 'node:crypto'
import {CustomerFileError} from './customerFiles.js'

export function createCustomerFileObjects(bucket) {
  return {
    put: async (path,bytes,contentType) => {
      const file=bucket.file(path),sha256=createHash('sha256').update(bytes).digest('hex')
      try {
        await file.save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},
          metadata:{contentType,cacheControl:'private, no-store',metadata:{sha256}}})
      } catch(e) {
        if(e.code!==412)throw e
        const [meta]=await file.getMetadata()
        if(meta.metadata?.sha256!==sha256||Number(meta.size)!==bytes.length||meta.contentType!==contentType)throw new CustomerFileError('A different upload chunk already exists. Reselect the original file.')
      }
    },
    // CRC32C applies to whole objects. Reassembled range downloads are checked
    // against the original SHA256 in the browser before preview or download.
    read: async(path,options={})=>(await bucket.file(path).download({...options,validation:options.start===undefined?'crc32c':false}))[0],
    removePrefix: prefix=>bucket.deleteFiles({prefix,force:true}),
  }
}
