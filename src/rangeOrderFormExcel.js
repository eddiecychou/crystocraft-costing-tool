import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { ocDateOnly } from './ocTime'

const C = { ink:'FF222222', brand:'FF6E2433', white:'FFFFFFFF', input:'FFE8F3FC', border:'FFE9E8E6', grey:'FFECECEC', muted:'FF666666', alt:'FFFAF7F2', alert:'FF9C3526' }
const HEADER = 4
const NOTICE = { invalid:'Check quantities', option:'Confirm option specification', concept:'Concept — enquiry only', price:'Quotation required', stock:'Confirm stock', overstock:'Over stock — confirm' }
const FONT = {name:'Calibri',size:10,color:{argb:C.ink}}
const fill = argb => ({type:'pattern',pattern:'solid',fgColor:{argb}})
const money = precision => '#,##0.'+'0'.repeat(precision)
const formula = (expression,result=0) => ({formula:expression,result})
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

export async function buildRangeOrderWorkbook(model, {images=new Map()}={}) {
  if(!model.rows.length)throw Error('There are no buyer-visible products in this selection.')
  const wb=new ExcelJS.Workbook()
  wb.creator='Crystocraft';wb.title='Crystocraft Range — Order Form'
  wb.created=new Date(model.generatedAt);wb.calcProperties={fullCalcOnLoad:true}
  const ws=wb.addWorksheet('Order form')
  const firstColor=5,qtyCol=firstColor+model.colors.length,amountCol=qtyCol+1,checkCol=amountCol+1
  const letter=col=>ws.getColumn(col).letter,last=letter(amountCol),checkLetter=letter(checkCol)
  const currencyFormat=money(model.precision)
  const widths=[12,30,30,13,...model.colors.map(()=>9),10,14,16]
  widths.forEach((width,i)=>{ws.getColumn(i+1).width=width})
  // A buyer sees only the order grid. This last column holds buyer-safe guards,
  // with exceptions surfaced through highlighting and one short footer note.
  ws.getColumn(checkCol).hidden=true
  const set=(address,value,options={})=>{
    const cell=ws.getCell(address);cell.value=value===''?null:value
    cell.font={...FONT,...options.font}
    cell.alignment={vertical:'middle',wrapText:true,...options.alignment}
    if(options.input){cell.protection={locked:false};cell.fill=fill(C.input)}
    if(options.numberFormat)cell.numFmt=options.numberFormat
    return cell
  }
  ws.mergeCells('A1:C1')
  set('A1','CRYSTOCRAFT · ORDER FORM',{font:{size:16,color:{argb:C.white}}}).fill=fill(C.brand)
  ws.getRow(1).height=34
  ws.mergeCells('A2:C2');set('A2',model.buyer||'Trade buyer',{font:{color:{argb:C.muted}}})
  ws.getRow(2).height=30
  ws.mergeCells(`A3:${last}3`)
  set('A3','Enter quantities in blue cells. Grey cells are unavailable.',{font:{size:9,color:{argb:C.muted}}})
  ws.getRow(3).height=20
  const headers=['Photo','Product / code / size','Crystal option / finish',`Unit price (${model.currency})`,
    ...model.colors.map(color=>[color.name,color.code==='__AS_SHOWN__'?'':color.code].filter(Boolean).join('\n')),
    'Qty',`Amount (${model.currency})`,'Check']
  headers.forEach((text,i)=>{
    const cell=set(`${letter(i+1)}${HEADER}`,text,{font:{bold:true,color:{argb:C.white}}})
    cell.fill=fill(C.brand)
  })
  // No filter arrows or repeated "Order qty" labels. Allow room for native
  // Excel's wrapped colour names/codes without shrinking the text.
  ws.getRow(HEADER).height=Math.min(408,Math.max(54,...headers.map((text,i)=>height(text,Math.max(6,widths[i]-2)))))
  const placed=[],imageIds=new Map();let rowNumber=HEADER+1
  for(const [index,item]of model.rows.entries()){
    const product=[item.name,item.code,item.size].filter(Boolean).join('\n')
    const details=[item.option,item.status==='Retired Stock'?'Limited stock':''].filter(Boolean).join('\n')
    const productParts=textParts(product,28),optionParts=textParts(details,28)
    const start=rowNumber
    for(let part=0;part<Math.max(productParts.length,optionParts.length);part++,rowNumber++){
      const rr=ws.getRow(rowNumber),b=productParts[part]||`${item.code}\nDetails continued`,c=optionParts[part]||''
      rr.height=Math.min(408,Math.max(part===0?60:28,height(b,28),height(c,28)))
      for(let col=1;col<=checkCol;col++){
        const cell=set(`${letter(col)}${rowNumber}`,'')
        cell.fill=fill(index%2?C.alt:C.white);cell.border={bottom:{style:'hair',color:{argb:C.border}}}
      }
      set(`B${rowNumber}`,b);set(`C${rowNumber}`,c)
      if(part)continue
      set(`D${rowNumber}`,item.price==null?NOTICE.price:item.price,{numberFormat:currencyFormat,alignment:{horizontal:'right'},font:{bold:true}})
      for(const [colorIndex,color]of model.colors.entries()){
        const address=`${letter(firstColor+colorIndex)}${rowNumber}`,allowed=item.colors.includes(color.code)
        const cell=set(address,null,{input:allowed,alignment:{horizontal:'center'},numberFormat:'#,##0'})
        if(!allowed){cell.fill=fill(C.grey);continue}
        cell.dataValidation={type:'whole',operator:'greaterThanOrEqual',formulae:[0],allowBlank:true,showErrorMessage:true,errorStyle:'stop',errorTitle:'Whole quantities only',error:'Enter a whole quantity of zero or more.',showInputMessage:true,promptTitle:color.name.slice(0,32),prompt:`${item.skuByColor[color.code]}. Enter whole quantities; blank means no order.`.slice(0,255)}
      }
      const inputAddresses=model.colors.flatMap((color,i)=>item.colors.includes(color.code)?[`${letter(firstColor+i)}${rowNumber}`]:[])
      const qty=`${letter(qtyCol)}${start}`,amount=`${letter(amountCol)}${start}`,check=`${checkLetter}${start}`
      set(qty,formula(`SUM(${inputAddresses.join(',')})`),{numberFormat:'#,##0;-#,##0;;@',alignment:{horizontal:'right'}})
      set(amount,formula(`IF(${check}="${NOTICE.invalid}","${NOTICE.invalid}",IF(${qty}=0,"",IF(ISNUMBER(D${start}),ROUND(${qty}*D${start},${model.precision}),"Quote required")))`,''),{numberFormat:currencyFormat,alignment:{horizontal:'right'}})
      placed.push({...item,row:start,inputAddresses,qty,amount,check})
      const image=images.get(item.image)
      if(image){
        let id=imageIds.get(item.image)
        if(id==null){id=wb.addImage({base64:image.data,extension:'jpeg'});imageIds.set(item.image,id)}
        const scale=Math.min(64/image.width,50/image.height,1),w=image.width*scale,h=image.height*scale
        ws.addImage(id,{tl:{col:(80-w)/2/80,row:start-1+Math.max(0,(rr.height/0.75-h)/2)/(rr.height/0.75)},ext:{width:w,height:h},editAs:'oneCell'})
      }
    }
  }
  for(const item of placed){
    const invalid=`SUM(${item.inputAddresses.map(ref=>`IF(ISNUMBER(${ref}),IF(${ref}<0,1,IF(MOD(${ref},1)<>0,1,0)),IF(${ref}="",0,1))`).join(',')})>0`
    const poolQty=`SUM(${placed.filter(other=>other.pool===item.pool).map(other=>other.qty).join(',')})`
    const review=item.review?`"${NOTICE.option}"`:item.status===NOTICE.concept?`"${NOTICE.concept}"`:item.price==null?`"${NOTICE.price}"`:item.status==='Retired Stock'?(item.stock==null?`"${NOTICE.stock}"`:`IF(${poolQty}>${item.stock},"${NOTICE.overstock}","")`):'""'
    set(item.check,formula(`IF(${invalid},"${NOTICE.invalid}",IF(${item.qty}=0,"",${review}))`,''))
  }
  const finalRow=rowNumber-1,totalRow=rowNumber,noteRow=totalRow+2,issuedRow=totalRow+3
  const qtyLetter=letter(qtyCol),amountLetter=letter(amountCol)
  const checks=`${checkLetter}${HEADER+1}:${checkLetter}${finalRow}`
  const invalidRows=`COUNTIF(${checks},"${NOTICE.invalid}")>0`
  const unquotedQty=`SUMIF(D${HEADER+1}:D${finalRow},"${NOTICE.price}",${qtyLetter}${HEADER+1}:${qtyLetter}${finalRow})`
  const issues=`SUM(${Object.values(NOTICE).map(message=>`COUNTIF(${checks},"${message}")`).join(',')})`
  const totalLabel=`IF(${unquotedQty}>0,"Priced subtotal (${model.currency})","Total (${model.currency})")`
  set('D1',formula(totalLabel,`Total (${model.currency})`),{font:{bold:true},alignment:{horizontal:'right'}})
  set('D2',formula(`${amountLetter}${totalRow}`),{font:{bold:true,size:12},numberFormat:currencyFormat,alignment:{horizontal:'right'}})
  ws.mergeCells(`A${totalRow}:D${totalRow}`)
  set(`A${totalRow}`,formula(totalLabel,`Total (${model.currency})`),{font:{bold:true}})
  set(`${qtyLetter}${totalRow}`,formula(`IF(${invalidRows},"${NOTICE.invalid}",SUM(${qtyLetter}${HEADER+1}:${qtyLetter}${finalRow}))`),{font:{bold:true},numberFormat:'#,##0'})
  set(`${amountLetter}${totalRow}`,formula(`IF(${invalidRows},"${NOTICE.invalid}",SUM(${amountLetter}${HEADER+1}:${amountLetter}${finalRow}))`),{font:{bold:true},numberFormat:currencyFormat})
  ws.getRow(totalRow).height=28
  ws.mergeCells(`A${noteRow}:${last}${noteRow}`)
  set(`A${noteRow}`,formula(`IF(${invalidRows},"Please enter whole quantities of zero or more.",IF(${unquotedQty}>0,"Some selected items need a quotation. The subtotal includes priced items only.",IF(${issues}>0,"Please confirm the highlighted items before placing your order.","")))`,''),{font:{size:9,color:{argb:C.alert}}})
  ws.getRow(noteRow).height=26
  set(`A${issuedRow}`,'Issued',{font:{size:9,color:{argb:C.muted}}})
  set(`B${issuedRow}`,new Date(ocDateOnly(new Date(model.generatedAt))+'T00:00:00Z'),{font:{size:9,color:{argb:C.muted}},numberFormat:'dd mmm yyyy'})
  ws.mergeCells(`C${issuedRow}:${last}${issuedRow}`)
  set(`C${issuedRow}`,'Prices valid 30 days. Final prices and availability confirmed on acceptance.',{font:{size:9,color:{argb:C.muted}}})
  ws.getRow(issuedRow).height=24
  for(const column of ['D',amountLetter])ws.addConditionalFormatting({ref:`${column}${HEADER+1}:${column}${finalRow}`,rules:[{type:'expression',formulae:[`$${checkLetter}${HEADER+1}<>""`],style:{font:{color:{argb:C.alert}},fill:fill('FFFCEEEB')}}]})
  ws.views=[{state:'frozen',xSplit:4,ySplit:HEADER,topLeftCell:`E${HEADER+1}`,activeCell:`E${HEADER+1}`,zoomScale:85,showGridLines:false}]
  ws.pageSetup={paperSize:9,orientation:'landscape',scale:100,printTitlesRow:`${HEADER}:${HEADER}`,printTitlesColumn:'A:D',margins:{left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.15,footer:0.2}}
  ws.pageSetup.printArea=`A1:${last}${issuedRow}`
  ws.headerFooter={oddFooter:'Crystocraft · Page &P of &N'}
  await ws.protect('',{selectLockedCells:true,selectUnlockedCells:true,formatRows:true,spinCount:1000})
  return wb
}

export async function rangeOrderFormBytes(model, options) {
  const workbook=await buildRangeOrderWorkbook(model,options)
  const bytes=await workbook.xlsx.writeBuffer()
  // ExcelJS exposes fullCalcOnLoad, but not calcMode. Set the standard OOXML
  // flags so editable quantities recalculate, including after reopening.
  const zip=await JSZip.loadAsync(bytes),part=zip.file('xl/workbook.xml')
  const xml=await part.async('string')
  if(!/<calcPr\b[^>]*\/>/.test(xml))throw Error('The Excel calculation settings could not be written.')
  const updated=xml.replace(/<calcPr\b([^>]*)\/>/,(_,attrs)=>`<calcPr${attrs.replace(/\s(?:calcMode|forceFullCalc)="[^"]*"/g,'')} calcMode="auto" forceFullCalc="1"/>`)
  zip.file('xl/workbook.xml',updated)
  return zip.generateAsync({type:'uint8array'})
}
