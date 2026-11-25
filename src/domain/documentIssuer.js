import { asOcDate, ocDateOnly } from '../ocTime.js'

// List revisions newest first. Keep the original letterhead as the undated
// fallback so legacy reprints use it even when no issue date is available.
const HONG_KONG_ISSUERS = Object.freeze([
  Object.freeze({
    effectiveFrom: null,
    name: 'United Art Metals Factory Limited',
    address: '11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong',
    whatsapp: '+852 4608 3219',
    email: 'sales@uart.com.hk',
  }),
])

export function hongKongDocumentIssuer(issuedOn, revisions = HONG_KONG_ISSUERS) {
  const day = ocDateOnly(issuedOn)
  const validDay = day && ocDateOnly(asOcDate(day)) === day
  return revisions.find(issuer => issuer.effectiveFrom === null || (validDay && day >= issuer.effectiveFrom))
}

export function documentIssuerContact({ whatsapp, email }, separator = '   |   ') {
  return [`WhatsApp: ${whatsapp}`, `Email: ${email}`].join(separator)
}
