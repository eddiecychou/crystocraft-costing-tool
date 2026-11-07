import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export async function openCustomerPdf(blob) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  // Render locally; do not evaluate PDF JavaScript, extract contacts, follow
  // links or send a private document to a third-party viewing service.
  const task=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,maxImageSize:16000000})
  try {
    const document=await task.promise
    // PDF.js 6 owns destruction on the loading task, not the document proxy.
    // Keep that library lifecycle detail out of the gallery/preview components.
    return {numPages:document.numPages,getPage:page=>document.getPage(page),destroy:()=>task.destroy()}
  } catch(e) { await task.destroy();throw e }
}
export async function customerFileThumbnail(blob) {
  const canvas = document.createElement('canvas')
  if (blob.type === 'application/pdf') {
    const pdf = await openCustomerPdf(blob)
    try {
      const page = await pdf.getPage(1), original = page.getViewport({scale:1}), viewport = page.getViewport({scale:Math.min(640/original.width,640/original.height)})
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
      await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise
    } finally { await pdf.destroy() }
  } else {
    const bitmap = await createImageBitmap(blob)
    try {
      const scale = Math.min(1,640/bitmap.width,640/bitmap.height)
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
      const ctx = canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)
    } finally { bitmap.close() }
  }
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not make a viewing thumbnail.')),'image/jpeg',0.85))
}
