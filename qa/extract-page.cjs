// Extract one page into its own PDF so qlmanage (which only ever renders page 1)
// can rasterise it. This is the missing link in the QA loop: render -> extract
// -> rasterise -> look at it.
const { PDFDocument } = require('pdf-lib')
const fs = require('fs')
;(async () => {
  const [, , src, pageNo, out] = process.argv
  const doc = await PDFDocument.load(fs.readFileSync(src))
  const one = await PDFDocument.create()
  const [p] = await one.copyPages(doc, [Number(pageNo) - 1])
  one.addPage(p)
  fs.writeFileSync(out, await one.save())
  console.log(`page ${pageNo} of ${doc.getPageCount()} -> ${out}`)
})()
