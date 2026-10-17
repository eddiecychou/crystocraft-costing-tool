import {useState} from 'react'
import {summaryDays} from '../customerSummary'
export default function useSummaryPeriod(){
 const [days,setDays]=useState(()=>{try{return summaryDays(localStorage.getItem('oc-summary-period') || 30)}catch{return 30}})
 return [days,value=>{const next=summaryDays(value);setDays(next);try{localStorage.setItem('oc-summary-period',String(next))}catch{/* storage optional */}}]
}
