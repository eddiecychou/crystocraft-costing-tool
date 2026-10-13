import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import QuoteProductPicker from '../src/components/QuoteProductPicker.jsx'

function Preview() {
  const [added, setAdded] = useState([])
  return <>
    <p data-testid="added">{added.map(p => p.key).join(',')}</p>
    <QuoteProductPicker existingKeys={['range_products:r1:A0002-001-C']} onAdd={setAdded} onClose={() => {}} />
  </>
}

createRoot(document.getElementById('root')).render(<Preview />)
