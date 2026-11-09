import ExcelJS from 'exceljs'
import { RANGE_CRYSTAL_BRANDS, RANGE_PLATINGS, RANGE_FORMAT_CODES } from './constants'
import { ocDateOnly } from './ocTime'

const C = { ink:'FF222222', brand:'FF6E2433', white:'FFFFFFFF', border:'FFE9E8E6', muted:'FF666666', alt:'FFFAF7F2' }
const HEADER = 4
const FONT = {name:'Calibri',size:10,color:{argb:C.ink}}
const fill = argb => ({type:'pattern',pattern:'solid',fgColor:{argb}})
const money = precision => '#,##0.'+'0'.repeat(precision)
const isWide = char => char.charCodeAt(0)>255

// Excel has a 409pt row limit. Split unusually long public labels into visible
// continuation rows, with ordering cells only on the first row of each option.
function textParts(text, width=32, maxLines=14) {
  const parts=[];let remaining=String(text)
  while(remaining){
    let end=0,line=0,lines=1
    for(const char of remaining){
      if(char==='\n'){lines++;line=0}else{line+=isWide(char)?2:1;if(line>width){lines++;line=isWide(char)?2:1}}
      if(lines>maxLines)break
      end+=char.length
    }
    if(end===remaining.length){parts.push(remaining);break}
    // Prefer a word/paragraph boundary, retaining its whitespace. A single
    // unbroken token or Chinese text still splits without losing characters.
    const boundary=Math.max(remaining.lastIndexOf(' ',end),remaining.lastIndexOf('\n',end))
    if(boundary>end/2)end=boundary+1
    parts.push(remaining.slice(0,end));remaining=remaining.slice(end)
  }
  return parts.length?parts:['']
}
const height = (text,width=32) => String(text).split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((n,c)=>n+(isWide(c)?2:1),0)/width)),0)*12+12

export async function readRangeOrderImage(url, signal) {
  if(!url)return null
  try {
    let response
    try {
      response=await fetch('/api/download-image?url='+encodeURIComponent(url),{signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)})
      if(!response.ok)throw Error('Image unavailable')
    }catch(error){
      if(signal?.aborted)throw error
      response=await fetch(url,{signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)})
      if(!response.ok)throw Error('Image unavailable')
    }
    const blob=await response.blob()
    const bitmap=await createImageBitmap(blob)
    try {
      const scale=Math.min(1,180/Math.max(bitmap.width,bitmap.height))
      const canvas=document.createElement('canvas')
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
      const context=canvas.getContext('2d');if(!context)return null
      context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height)
      context.drawImage(bitmap,0,0,canvas.width,canvas.height)
      return {data:canvas.toDataURL('image/jpeg',0.85),width:canvas.width,height:canvas.height}
    } finally {bitmap.close()}
  }catch(error){if(signal?.aborted)throw error;return null}
}

// Existing module/export names remain stable for the catalogue caller. The
// buyer-facing workbook is a static price list, with no order-entry logic.
export async function buildRangeOrderWorkbook(model, {images=new Map()}={}) {
  if(!model.rows.length)throw Error('There are no buyer-visible products in this selection.')
  const wb=new ExcelJS.Workbook()
  wb.creator='Crystocraft';wb.title='Crystocraft Range — Price List';wb.created=new Date(model.generatedAt)
  const ws=wb.addWorksheet('Price list'),guide=wb.addWorksheet('Code guide')
  const widths=[12,30,20,18,18,48,19],colorNames=new Map(model.colors.map(c=>[c.code,c.name]))
  widths.forEach((width,i)=>{ws.getColumn(i+1).width=width})
  ws.getColumn(3).numFmt='@'
  guide.getColumn(1).numFmt='@'
  function set(sheet,row,col,value,{bold=false,muted=false,moneyFormat=false}={}) {
    const cell=sheet.getCell(row,col);cell.value=value===''?null:value
    cell.font={...FONT,bold,color:{argb:muted?C.muted:C.ink}}
    cell.alignment={vertical:'middle',wrapText:true,horizontal:moneyFormat?'right':'left'}
    if(moneyFormat)cell.numFmt=money(model.precision)
    return cell
  }
  function banner(sheet,row,end,text) {
    sheet.mergeCells(row,1,row,end)
    const cell=set(sheet,row,1,text,{bold:true});cell.font={...FONT,bold:true,size:15,color:{argb:C.white}};cell.fill=fill(C.brand)
    sheet.getRow(row).height=32
  }
  banner(ws,1,7,'CRYSTOCRAFT RANGE · PRICE LIST')
  ws.mergeCells('A2:E2');set(ws,2,1,model.buyer||'Trade buyer',{muted:true})
  set(ws,2,6,'Issued',{muted:true});set(ws,2,7,new Date(ocDateOnly(new Date(model.generatedAt))+'T00:00:00Z')).numFmt='dd mmm yyyy'
  ws.getRow(2).height=26
  ws.mergeCells('A3:G3');set(ws,3,1,'Crystal colours and codes are listed per price option. See Code guide for the full item-code format.',{muted:true});ws.getRow(3).height=22
  const headers=['Photo','Product','Code','Size','Plating','Crystal options available',`Unit price (${model.currency})`]
  headers.forEach((label,i)=>{const c=set(ws,HEADER,i+1,label,{bold:true});c.font.color={argb:C.white};c.fill=fill(C.brand)})
  ws.getRow(HEADER).height=32
  const imageIds=new Map();let next=HEADER+1
  for(const [index,item]of model.rows.entries()) {
    const colours=item.colors.map(code=>code==='__AS_SHOWN__'?'As shown':`${code} — ${colorNames.get(code)||code}`).join('; ')
    const crystal=[item.crystalOption||item.option,colours,item.review?'Please confirm specification':''].filter(Boolean).join('\n')
    const product=[item.name,item.status==='Retired Stock'?'Retired stock':item.status==='Concept — enquiry only'?'Concept — enquiry only':''].filter(Boolean).join('\n')
    const displayCode=[item.code,item.runningNo?`Running no. ${item.runningNo}`:''].filter(Boolean).join('\n')
    const plating=[item.platingCode,item.plating].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' — ')
    const values=[null,product,displayCode,item.size,plating,crystal,item.price==null?'Quotation required':item.price]
    const parts=values.map((v,i)=>i===0||i===6?[v]:textParts(v||'',widths[i]-2))
    const start=next
    for(let part=0;part<Math.max(...parts.map(a=>a.length));part++,next++) {
      let rowHeight=part===0?66:28
      for(let i=0;i<7;i++) {
        const value=parts[i][part]??null,cell=set(ws,next,i+1,value,{bold:i===6,moneyFormat:i===6&&typeof value==='number'})
        cell.fill=fill(index%2?C.alt:C.white);cell.border={bottom:{style:'hair',color:{argb:C.border}}}
        if(value!=null)rowHeight=Math.max(rowHeight,height(value,widths[i]-2))
      }
      ws.getRow(next).height=Math.min(408,rowHeight)
    }
    const image=images.get(item.image)
    if(image) {
      let id=imageIds.get(item.image)
      if(id==null){id=wb.addImage({base64:image.data,extension:'jpeg'});imageIds.set(item.image,id)}
      const scale=Math.min(70/image.width,62/image.height,1),w=image.width*scale,h=image.height*scale,rowHeight=ws.getRow(start).height/0.75
      ws.addImage(id,{tl:{col:(80-w)/2/80,row:start-1+(rowHeight-h)/2/rowHeight},ext:{width:w,height:h},editAs:'oneCell'})
    }
  }
  ws.mergeCells(`A${next+1}:G${next+1}`)
  set(ws,next+1,1,'Prices valid 30 days. Final prices and availability confirmed on quotation. Retired stock is available while stocks last; no further production.',{muted:true})
  ws.getRow(next+1).height=30
  ws.views=[{state:'frozen',xSplit:3,ySplit:HEADER,topLeftCell:`D${HEADER+1}`,activeCell:`D${HEADER+1}`,showGridLines:false,zoomScale:90}]
  ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:`${HEADER}:${HEADER}`,printArea:`A1:G${next+1}`,margins:{left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.15,footer:0.2}}
  ws.headerFooter={oddFooter:'Crystocraft · Page &P of &N'}

  ;[20,37,65].forEach((w,i)=>{guide.getColumn(i+1).width=w})
  banner(guide,1,3,'CODE GUIDE')
  guide.mergeCells('A2:C2');set(guide,2,1,'Example: D0002-001-GC1',{bold:true});guide.getRow(2).height=26
  guide.mergeCells('A3:C3');set(guide,3,1,'D = crystal prefix; 0002 = design; 001 = format; G = plating; C1 = crystal colour. An optional running number follows the colour.',{muted:true});guide.getRow(3).height=36
  let gr=5
  const add=(code,meaning,detail='')=>{
    const vals=[code,meaning,detail],parts=vals.map((v,i)=>textParts(v,[18,35,63][i]))
    for(let n=0;n<Math.max(...parts.map(a=>a.length));n++,gr++){
      let h=24;parts.forEach((p,i)=>{const v=p[n]||'',cell=set(guide,gr,i+1,v);if(i===0&&/^\d+$/.test(v))cell.numFmt='0'.repeat(v.length);h=Math.max(h,height(v,[18,35,63][i]))});guide.getRow(gr).height=Math.min(408,h)
    }
  }
  const section=title=>{guide.mergeCells(gr,1,gr,3);const c=set(guide,gr,1,title,{bold:true});c.fill=fill(C.alt);guide.getRow(gr).height=28;gr++}
  section('How to use the price list')
  add('Product code','Design and format','The Code column shows the crystal prefix + design number and format. Combine it with the plating and one listed colour to identify the full item code.')
  add('Example','D0002-001 + G + C1','Full item code: D0002-001-GC1. A running number, if shown in the Code column, is appended after the colour.')
  add('Price','Per piece in '+model.currency,'Each row is a separate price option. Use only the colours listed on that row. Quotation required means no confirmed customer price is shown.')
  add('As shown','No separate colour code','The source option has no selected colour code. Refer to the product image/specification; do not add a colour suffix.')
  section('Crystal prefixes and series')
  const brands=new Map(RANGE_CRYSTAL_BRANDS.map(b=>[b.code,b.name])),prefixes=[...new Set(model.rows.map(r=>r.code.match(/^[A-Za-z]+/)?.[0]||'').filter(Boolean))]
  for(const prefix of prefixes)add(prefix,brands.get(prefix)|| (prefix==='UA'?'Swarovski, crystal body':`${prefix} series`),brands.has(prefix)?'Same design number and format can be offered with different crystal options.':'Use the option description in the price list. No additional crystal type is inferred from this series code.')
  section('Format codes in this price list')
  const formats=new Map(RANGE_FORMAT_CODES.map(f=>[f.code,f.label]))
  for(const code of [...new Set(model.rows.map(r=>r.code.split('-')[1]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})))add(code,formats.get(code)||'Format code as recorded','The middle segment identifies the product format.')
  section('Plating codes in this price list')
  const platings=new Map(RANGE_PLATINGS.map(p=>[p.code,p.name]))
  for(const code of [...new Set(model.rows.map(r=>r.platingCode).filter(Boolean))])add(code,model.rows.find(r=>r.platingCode===code)?.plating||platings.get(code)||code,'Use the plating code printed on the applicable price row.')
  section('Crystal colour / configuration codes')
  for(const color of model.colors)if(color.code!=='__AS_SHOWN__')add(color.code,color.name,'Only available on price rows that list this code.')
  guide.views=[{showGridLines:false,zoomScale:90}]
  guide.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:`A1:C${gr-1}`,margins:{left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.15,footer:0.2}}
  guide.headerFooter={oddFooter:'Crystocraft · Code guide · Page &P of &N'}
  return wb
}

export async function rangeOrderFormBytes(model, options) {
  const workbook=await buildRangeOrderWorkbook(model,options)
  return workbook.xlsx.writeBuffer()
}
