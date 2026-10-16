import {createRoot} from 'react-dom/client'
import {MemoryRouter, Routes, Route} from 'react-router-dom'
import RangeForm from '../src/pages/RangeForm'
import RangeComponentForm from '../src/pages/RangeComponentForm'
import '../src/index.css'
const q=new URLSearchParams(window.location.search),id=q.get('range'),component=q.get('component')
if(!id&&!component)throw Error('Supply the emulator fixture ID')
createRoot(document.getElementById('root')).render(<><div style={{background:'#fff3c4',padding:12}}>LOCAL EMULATOR QA — actual OC forms; mock admin identity; no production login or live data.</div><MemoryRouter initialEntries={[component?`/components/${component}`:`/range/${id}/edit${q.get('quick') === '1' ? '?quick=1' : ''}`]}><Routes><Route path="/range/:id/edit" element={<RangeForm/>}/><Route path="/range/:id" element={<RangeForm/>}/><Route path="/components/:id" element={<RangeComponentForm/>}/></Routes></MemoryRouter></>)
