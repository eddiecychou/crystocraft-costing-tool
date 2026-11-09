import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { ocDateOnly } from './ocTime'

const C = { ink:'FF222222', brand:'FF6E2433', white:'FFFFFFFF', input:'FFE8F3FC', border:'FFE9E8E6', grey:'FFECECEC', muted:'FF666666', alt:'FFFAF7F2', alert:'FF9C3526' }
const HEADER = 10
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
  wb.creator='Crystocraft';wb.title='Crystocraft Range — Buyer Order Form'
  wb.created=new Date(model.generatedAt);wb.calcProperties={fullCalcOnLoad:true}
  const ws=wb.addWorksheet('Order form')
  const firstColor=5,qtyCol=firstColor+model.colors.length,amountCol=qtyCol+1,checkCol=amountCol+1
  const letter=col=>ws.getColumn(col).letter,last=letter(checkCol)
  const currencyFormat=money(model.precision)
  ;[14,34,36,14,...model.colors.map(()=>11),12,16,36].forEach((width,i)=>{ws.getColumn(i+1).width=width})
  const set=(address,value,options={})=>{
    const cell=ws.getCell(address);cell.value=value===''?null:value;cell.font={...FONT,...options.font};cell.alignment={vertical:'middle',wrapText:true,...options.alignment}
    if(options.input){cell.protection={locked:false};cell.fill=fill(C.input)}
    if(options.numberFormat)cell.numFmt=options.numberFormat
    return cell
  }
  ws.mergeCells('A1:H1');set('A1','CRYSTOCRAFT · BUYER ORDER FORM',{font:{size:17,color:{argb:C.white}}}).fill=fill(C.brand);ws.getRow(1).height=34
  set('A2','Issued');set('B2',new Date(ocDateOnly(new Date(model.generatedAt))+'T00:00:00Z'),{numberFormat:'dd mmm yyyy'})
  set('C2','Currency');set('D2',model.currency);set('E2','Prepared for');ws.mergeCells('F2:H2');set('F2',model.buyer||'Trade buyer')
  for(const [row,label,value,right]of[[3,'Company',model.buyer,'Buyer PO'],[4,'Contact / email',[model.contact,model.email].filter(Boolean).join(' · '),'Requested date']]){
    set('A'+row,label);ws.mergeCells(`B${row}:D${row}`);set('B'+row,value,{input:true});set('E'+row,right);ws.mergeCells(`F${row}:H${row}`);set('F'+row,'',{input:true,numberFormat:row===4?'dd mmm yyyy':undefined});ws.getRow(row).height=30
  }
  set('A5','Buyer notes');ws.mergeCells('B5:H5');set('B5','',{input:true});ws.getRow(5).height=32
  set('A6','Total quantity');set('C6',`Priced subtotal (${model.currency})`)
  set('A7','Unquoted quantity');set('C7','Rows to review')
  for(const row of [2,6,7])ws.getRow(row).height=34
  ws.mergeCells('E6:H6');set('E6','Enter whole quantities in blue cells. Grey cells are unavailable.')
  ws.mergeCells('E7:H7');set('E7','Check the order notes before returning this file to Crystocraft.')
  ws.mergeCells(`A8:${last}8`);set('A8','Prices valid 30 days from issue. Stock is a snapshot, not a reservation. MOQ is informational; colour-mixing rules need confirmation. Photos are representative.');ws.getRow(8).height=30
  const headers=['Photo','Product / code / size','Crystal option / finish',`Unit price (${model.currency})`,...model.colors.map(color=>`${color.name}\n${color.code==='__AS_SHOWN__'?'':color.code}\nOrder qty`),'Total qty',`Amount (${model.currency})`,'Order check']
  headers.forEach((text,i)=>{const cell=set(`${letter(i+1)}${HEADER}`,text,{font:{bold:true,color:{argb:C.white}}});cell.fill=fill(C.brand)})
  ws.getRow(HEADER).height=52
  const placed=[],imageIds=new Map();let rowNumber=HEADER+1
  for(const [index,item]of model.rows.entries()){
    const product=[item.name,item.code,item.size,item.status].filter(Boolean).join('\n')
    const details=[item.option,item.plating?`Finish: ${item.plating}`:'',item.moq!=null?`MOQ: ${item.moq} (mixing rule to confirm)`:'',item.leadWeeks?`Lead time: ${item.leadWeeks} weeks`:'',item.status==='Retired Stock'?item.stock==null?'Confirm stock':`Stock snapshot: ${item.stock} total for this finish`:''].filter(Boolean).join('\n')
    const productParts=textParts(product),optionParts=textParts(details)
    const start=rowNumber
    for(let part=0;part<Math.max(productParts.length,optionParts.length);part++,rowNumber++){
      const rr=ws.getRow(rowNumber),b=productParts[part]||`${item.code}\nDetails continued`,c=optionParts[part]||''
      rr.height=Math.min(408,Math.max(part===0?82:28,height(b),height(c)))
      for(let col=1;col<=checkCol;col++){
        const cell=set(`${letter(col)}${rowNumber}`,'');cell.fill=fill(index%2?C.alt:C.white);cell.border={bottom:{style:'hair',color:{argb:C.border}}}
      }
      set(`B${rowNumber}`,b);set(`C${rowNumber}`,c)
      if(part)continue
      const price=set(`D${rowNumber}`,item.price==null?'Quotation required':item.price,{numberFormat:currencyFormat,alignment:{horizontal:'right'}})
      price.font={...FONT,bold:true}
      for(const [colorIndex,color]of model.colors.entries()){
        const address=`${letter(firstColor+colorIndex)}${rowNumber}`,allowed=item.colors.includes(color.code)
        const cell=set(address,allowed?null:'—',{input:allowed,alignment:{horizontal:'center'},numberFormat:'#,##0'})
        if(!allowed){cell.fill=fill(C.grey);continue}
        cell.dataValidation={type:'whole',operator:'greaterThanOrEqual',formulae:[0],allowBlank:true,showErrorMessage:true,errorStyle:'stop',errorTitle:'Whole quantities only',error:'Enter a whole quantity of zero or more.',showInputMessage:true,promptTitle:color.name.slice(0,32),prompt:`${item.skuByColor[color.code]}. Enter whole quantities; blank means no order.`.slice(0,255)}
      }
      const range=`${letter(firstColor)}${rowNumber}:${letter(qtyCol-1)}${rowNumber}`
      // Read only editable numeric cells, never the locked em-dash cells.
      const inputAddresses=model.colors.flatMap((color,i)=>item.colors.includes(color.code)?[`${letter(firstColor+i)}${rowNumber}`]:[])
      const sum=`SUM(${inputAddresses.join(',')})`
      set(`${letter(qtyCol)}${rowNumber}`,formula(sum),{numberFormat:'#,##0',alignment:{horizontal:'right'}})
      set(`${letter(amountCol)}${rowNumber}`,formula(`IF(${letter(checkCol)}${rowNumber}="${NOTICE.invalid}","${NOTICE.invalid}",IF(${letter(qtyCol)}${rowNumber}=0,"",IF(ISNUMBER(D${rowNumber}),ROUND(${letter(qtyCol)}${rowNumber}*D${rowNumber},${model.precision}),"")))`,''),{numberFormat:currencyFormat,alignment:{horizontal:'right'}})
      placed.push({...item,row:start,inputAddresses,range,qty:`${letter(qtyCol)}${start}`,amount:`${letter(amountCol)}${start}`,check:`${letter(checkCol)}${start}`})
      const image=images.get(item.image)
      if(image){
        let id=imageIds.get(item.image)
        if(id==null){id=wb.addImage({base64:image.data,extension:'jpeg'});imageIds.set(item.image,id)}
        const scale=Math.min(88/image.width,74/image.height,1),w=image.width*scale,h=image.height*scale
        ws.addImage(id,{tl:{col:(98-w)/2/98,row:start-1+Math.max(0,(rr.height/0.75-h)/2)/(rr.height/0.75)},ext:{width:w,height:h},editAs:'oneCell'})
      }else set(`A${start}`,'Image unavailable',{font:{size:9,color:{argb:C.muted}}})
    }
  }
  for(const item of placed){
    const refs=item.inputAddresses,positiveConditions=refs.map(ref=>`IF(ISNUMBER(${ref}),IF(${ref}<0,1,IF(MOD(${ref},1)<>0,1,0)),IF(${ref}="",0,1))`)
    const invalid=`SUM(${positiveConditions.join(',')})>0`
    const group=placed.filter(other=>other.pool===item.pool)
    const poolQty=`SUM(${group.map(other=>other.qty).join(',')})`
    const review=item.review?`"${NOTICE.option}"`:item.status===NOTICE.concept?`"${NOTICE.concept}"`:item.price==null?`"${NOTICE.price}"`:item.status==='Retired Stock'?(item.stock==null?`"${NOTICE.stock}"`:`IF(${poolQty}>${item.stock},"${NOTICE.overstock}","")`):'""'
    set(item.check,formula(`IF(${invalid},"${NOTICE.invalid}",IF(${item.qty}=0,"",${review}))`,''),{font:{color:{argb:C.alert}}})
  }
  const finalRow=rowNumber-1,qtyLetter=letter(qtyCol),amountLetter=letter(amountCol),checkLetter=letter(checkCol)
  const invalidRows=`COUNTIF(${checkLetter}${HEADER+1}:${checkLetter}${finalRow},"${NOTICE.invalid}")>0`
  set('B6',formula(`IF(${invalidRows},"${NOTICE.invalid}",SUM(${qtyLetter}${HEADER+1}:${qtyLetter}${finalRow}))`),{font:{bold:true,size:12},numberFormat:'#,##0'})
  set('D6',formula(`IF(${invalidRows},"${NOTICE.invalid}",SUM(${amountLetter}${HEADER+1}:${amountLetter}${finalRow}))`),{font:{bold:true,size:12},numberFormat:currencyFormat})
  set('B7',formula(`SUMIF(D${HEADER+1}:D${finalRow},"Quotation required",${qtyLetter}${HEADER+1}:${qtyLetter}${finalRow})`),{numberFormat:'#,##0'})
  const reviewCounts=Object.values(NOTICE).map(message=>`COUNTIF(${checkLetter}${HEADER+1}:${checkLetter}${finalRow},"${message}")`)
  set('D7',formula(`SUM(${reviewCounts.join(',')})`),{numberFormat:'#,##0'})
  ws.autoFilter={from:{row:HEADER,column:2},to:{row:finalRow,column:checkCol}}
  ws.views=[{state:'frozen',xSplit:4,ySplit:HEADER,topLeftCell:`E${HEADER+1}`,activeCell:`E${HEADER+1}`,zoomScale:85}]
  ws.pageSetup={paperSize:9,orientation:'landscape',scale:100,printTitlesRow:`${HEADER}:${HEADER}`,printTitlesColumn:'A:D',margins:{left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.15,footer:0.2}}
  ws.pageSetup.printArea=`A1:${last}${finalRow}`
  ws.headerFooter={oddFooter:'Crystocraft · Page &P of &N'}
  await ws.protect('',{selectLockedCells:true,selectUnlockedCells:true,formatRows:true,autoFilter:true,spinCount:1000})
  const guide=wb.addWorksheet('Colour guide')
  guide.columns=[{width:18},{width:42},{width:16},{width:66}]
  guide.addRow(['Colour code','Colour name','Swatch','Ordering guide'])
  guide.getRow(1).font={...FONT,bold:true,color:{argb:C.white}};guide.getRow(1).fill=fill(C.brand);guide.getRow(1).height=26
  model.colors.forEach((color,i)=>{
    const rr=guide.addRow([color.code==='__AS_SHOWN__'?'—':color.code,color.name,null,'Use the matching quantity column on Order form.']);rr.font=FONT;rr.height=30;rr.alignment={vertical:'middle',wrapText:true}
    const hex=color.swatch.replace(/^#/,'')
    if(/^[\da-f]{6}$/i.test(hex))rr.getCell(3).fill=fill('FF'+hex.toUpperCase())
    else rr.getCell(3).value='See product photo'
  })
  const end=model.colors.length+3
  for(const [i,text]of ['Blank quantity means no order. Grey cells are unavailable combinations.','Prices apply to the exact crystal option / finish on that row. Premium options remain separate.','Stock limits combine all colour quantities for the same product finish. Final availability needs confirmation.','Return the completed file to Crystocraft for review. This workbook does not create an order or reserve stock.','MOQ is shown for reference; colour mixing and order minimums will be confirmed.'].entries()){
    const n=end+i;guide.mergeCells(`A${n}:D${n}`);guide.getCell(`A${n}`).value=text;guide.getCell(`A${n}`).font=FONT;guide.getCell(`A${n}`).alignment={wrapText:true,vertical:'middle'};guide.getRow(n).height=30
  }
  guide.views=[{state:'frozen',ySplit:1}]
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
