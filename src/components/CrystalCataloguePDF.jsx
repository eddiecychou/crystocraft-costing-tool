import {Document,Page,View,Text,Image,Font,StyleSheet} from '@react-pdf/renderer'
import logo from '../assets/logo.png'
import Questrial from '../assets/fonts/Questrial-Regular.ttf'
import WorkSans from '../assets/fonts/WorkSans-Regular.ttf'
Font.register({family:'CrystalQuestrial',src:Questrial})
Font.register({family:'CrystalLabels',src:WorkSans})
const s=StyleSheet.create({page:{padding:32,fontFamily:'CrystalQuestrial',fontSize:10,color:'#222222'},logo:{width:115,height:28,objectFit:'contain',marginBottom:12},header:{fontFamily:'CrystalLabels',fontSize:9,color:'#666666',marginBottom:16},title:{fontSize:21,marginBottom:8},code:{fontSize:10,color:'#666666',marginBottom:12},photo:{width:230,height:190,objectFit:'contain',marginBottom:14},body:{fontSize:10,lineHeight:1.45,marginBottom:10},row:{borderTopWidth:0.5,borderTopColor:'#dddddd',paddingTop:7,marginTop:7},footer:{position:'absolute',bottom:16,left:32,right:32,fontSize:8,color:'#666666'}})
export default function CrystalCataloguePDF({products,title='Crystal Components'}) {
 return <Document title={'Crystocraft '+title} author="Crystocraft">{products.map(p=><Page key={p.id} size="A4" style={s.page}>
 <Image src={logo} style={s.logo}/><Text style={s.header}>CRYSTOCRAFT  /  CRYSTAL COMPONENTS</Text><Text style={s.title}>{p.name}</Text><Text style={s.code}>{p.code} · {p.origin==='swarovski_strass'?'Original Swarovski / Strass stock':'Crystocraft Components'}</Text>
 {p.photo&&<Image src={p.photo} style={s.photo}/>}
 <Text style={s.body}>{p.description}</Text><Text style={s.body}>{p.origin==='swarovski_strass'?'Clearance: existing stock only. No replenishment. Condition: '+p.condition:'Availability, customization and lead time confirmed on quotation.'}</Text>
 {p.article_reference&&<Text style={s.body}>{p.origin==='swarovski_strass'?'Original article: ':'Comparison reference: '}{p.article_reference}</Text>}
 {p.variants.map(v=><View key={v.id} style={s.row} wrap={false}><Text>{v.code} · {v.label}</Text><Text style={s.body}>{[v.size,v.colour,v.effect,v.holes&&v.holes+' holes',v.backing&&'Backing: '+v.backing,'Unit: '+v.unit].filter(Boolean).join(' · ')}</Text></View>)}
 <Text style={s.body}>Price on quotation. For crystal fabric, please provide a drawing and intended application. An enquiry does not reserve stock.</Text>
 <Text style={s.footer} fixed render={({pageNumber,totalPages})=>'Crystocraft · '+title+' · '+pageNumber+' / '+totalPages}/>
 </Page>)}</Document>
}
