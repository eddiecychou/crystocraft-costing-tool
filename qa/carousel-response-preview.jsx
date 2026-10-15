import {useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Link} from 'react-router-dom'
import Carousel from 'QA_CAROUSEL'
const params=new URLSearchParams(location.search)
const run=params.get('run')||crypto.randomUUID()
const image=(i,extra='')=>({url:`https://firebasestorage.googleapis.com/v0/b/fixture/o/photo-${i}.svg?run=${run}${extra}`,caption:`Photo ${i+1}`})
function simulateGesture(vertical=false){
 const node=document.querySelector('[data-testid=carousel] > div')
 const touch=(x,y)=>({identifier:1,target:node,clientX:x,clientY:y,pageX:x,pageY:y,screenX:x,screenY:y})
 const start=touch(160,160),end=touch(vertical?155:70,vertical?60:155)
 node.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch(start)],changedTouches:[new Touch(start)]}))
 node.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,touches:[new Touch(end)],changedTouches:[new Touch(end)]}))
 node.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[],changedTouches:[new Touch(end)]}))
}
function App(){
 const [images,setImages]=useState(Array.from({length:8},(_,i)=>image(i)))
 const [measurement,setMeasurement]=useState({ready:false,switch_ms:null})
 const [navigation,setNavigation]=useState(false)
 const click=useRef(null)
 const surface=params.get('surface')||'admin'
 return <MemoryRouter><div className="p-6 space-y-4 max-w-xl">
 <h1 className="text-xl">{surface==='customer'?'Customer catalogue':'Admin catalogue'} · carousel response</h1>
 <p>Seeded photos with an 800 ms image response. Eight photos; only neighbours should warm.</p>
 <Link to="/detail" className={`${surface==='customer'?'mosaic-tile':'card'} block`} onClick={e=>{e.preventDefault();setNavigation(true)}}
 onClickCapture={e=>{if(e.target.closest('button')){click.current=performance.now();setMeasurement(m=>({...m,switch_ms:null}))}}}>
 <div className="aspect-square relative" data-testid="carousel" onLoadCapture={e=>{
 if(e.target.tagName!=='IMG')return
 setMeasurement({ready:true,switch_ms:click.current===null?null:Math.round(performance.now()-click.current),source:e.target.currentSrc})
 }}><Carousel images={images} alt="Test product" fallback={<span>No photo</span>}/></div>
 <p className="p-4">{surface==='customer'?'Customer product':'Admin product'}</p></Link>
 <div className="flex flex-wrap gap-2">
 <button className="btn-secondary" onClick={()=>setImages([image(7),image(6)])}>Replace gallery</button>
 <button className="btn-secondary" onClick={()=>setImages([image(0),{url:`/broken.svg?run=${run}`}])}>Broken next image</button>
 <button className="btn-secondary" onClick={()=>simulateGesture()}>Swipe left</button>
 <button className="btn-secondary" onClick={()=>simulateGesture(true)}>Vertical scroll gesture</button>
 <button className="btn-secondary" onClick={()=>setImages([])}>Empty gallery</button>
 </div>
 <output data-testid="measurement" className="block text-sm break-all">{JSON.stringify({...measurement,navigation})}</output>
 <div style={{height:2000}}>Offscreen gallery below</div>
 <div className="aspect-square relative" data-testid="offscreen"><Carousel images={[image(0,'&offscreen=1'),image(1,'&offscreen=1')]} alt="Offscreen"/></div>
 </div></MemoryRouter>
}
createRoot(document.getElementById('root')).render(<App/>);
