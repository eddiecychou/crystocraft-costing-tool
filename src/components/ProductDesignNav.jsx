import {useId,useState} from 'react'
import {NavLink,useLocation} from 'react-router-dom'

export default function ProductDesignNav(){
 const {pathname}=useLocation()
 const onProjects=pathname.startsWith('/design/projects')
 const [open,setOpen]=useState(!onProjects),panelId=useId()
 const links=[['/design/products','Gallery & design sources'],['/design/templates','JSON templates'],['/design/generations','Generations'],['/design/tools','Workbench guide']]
 return <div className="mb-6 min-w-0">
  <nav aria-label="Product Design navigation" className="flex border-b border-warm-grey gap-1">
   <NavLink to="/design/projects" onClick={()=>setOpen(false)} className={`flex-1 sm:flex-none inline-flex justify-center items-center min-h-[44px] px-4 border-b-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${onProjects?'border-brand-600 text-brand-600':'border-transparent text-ink-60 hover:bg-white'}`}>Projects</NavLink>
   <button type="button" aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(v=>!v)} className={`flex-1 sm:flex-none inline-flex justify-center items-center gap-2 min-h-[44px] px-4 border-b-2 text-sm hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${!onProjects?'border-brand-600 bg-white text-brand-600':open?'border-transparent bg-white text-brand-600':'border-transparent text-ink-60'}`}>
    Design tools <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={open?'rotate-180':''}><path d="m6 9 6 6 6-6"/></svg>
   </button>
  </nav>
  <nav id={panelId} hidden={!open} aria-label="Product Design tools" className={open?'mt-3 card p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1':'hidden'}>
   {links.map(([to,label])=><NavLink key={to} to={to} className={({isActive})=>`min-w-0 min-h-[44px] flex items-center px-3 py-2 text-sm break-words hover:bg-ivory hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${isActive?'bg-ivory text-brand-600 font-medium':'text-ink-70'}`}>{label}</NavLink>)}
  </nav>
 </div>
}
