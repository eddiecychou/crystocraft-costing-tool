import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import WhatsAppImport from '../src/pages/WhatsAppImport.jsx'

// Seeded preview of the real WhatsAppImport page (data layer stubbed by
// whatsapp-import-smoke.mjs) so the migration review + dry-run UI can be
// smoke-tested headlessly without Firebase or a login.
createRoot(document.getElementById('root')).render(
  <MemoryRouter>
    <WhatsAppImport />
  </MemoryRouter>
)
