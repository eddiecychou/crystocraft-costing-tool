// Best-effort E.164 calling-code -> country lookup (V8.2, WhatsApp lead
// import — owner, 2026-08-12: "the phone number can tell where the prospect
// comes from ... so I don't need to key in every time"). Scoped to
// CUSTOMER_COUNTRIES (domain/customer.js) so a match is always a valid,
// already-recognized country string elsewhere in the app.
//
// NOT authoritative — several codes are genuinely ambiguous (+1 covers both
// the US and Canada; +7 covers both Russia and Kazakhstan) and this always
// picks one. It's a starting guess to save typing, always editable
// afterward on the actual lead/customer record — never trust it for
// anything that matters more than a default.
const CODES = [
  // 3-digit codes checked first (longest-prefix match).
  ['212', 'Morocco'], ['213', 'Algeria'], ['216', 'Tunisia'], ['218', 'Libya'],
  ['234', 'Nigeria'], ['254', 'Kenya'],
  ['351', 'Portugal'], ['352', 'Luxembourg'], ['353', 'Ireland'], ['357', 'Cyprus'],
  ['358', 'Finland'], ['359', 'Bulgaria'],
  ['370', 'Lithuania'], ['371', 'Latvia'], ['372', 'Estonia'], ['373', 'Moldova'], ['375', 'Belarus'],
  ['380', 'Ukraine'], ['381', 'Serbia'], ['385', 'Croatia'], ['386', 'Slovenia'],
  ['420', 'Czech Republic'], ['421', 'Slovakia'],
  ['504', 'Honduras'],
  ['593', 'Ecuador'],
  ['852', 'Hong Kong'], ['853', 'Macau'], ['855', 'Cambodia'], ['886', 'Taiwan'],
  ['960', 'Maldives'], ['961', 'Lebanon'], ['964', 'Iraq'], ['965', 'Kuwait'], ['966', 'Saudi Arabia'],
  ['968', 'Oman'], ['971', 'United Arab Emirates'], ['972', 'Israel'], ['974', 'Qatar'], ['976', 'Mongolia'],
  ['998', 'Uzbekistan'],
  // 2-digit
  ['20', 'Egypt'], ['27', 'South Africa'],
  ['30', 'Greece'], ['31', 'Netherlands'], ['32', 'Belgium'], ['33', 'France'], ['34', 'Spain'],
  ['36', 'Hungary'], ['39', 'Italy'],
  ['40', 'Romania'], ['41', 'Switzerland'], ['43', 'Austria'], ['44', 'United Kingdom'],
  ['45', 'Denmark'], ['46', 'Sweden'], ['47', 'Norway'], ['48', 'Poland'], ['49', 'Germany'],
  ['51', 'Peru'], ['52', 'Mexico'], ['54', 'Argentina'], ['55', 'Brazil'], ['56', 'Chile'], ['57', 'Colombia'],
  ['58', 'Venezuela'],
  ['60', 'Malaysia'], ['61', 'Australia'], ['62', 'Indonesia'], ['63', 'Philippines'],
  ['64', 'New Zealand'], ['65', 'Singapore'], ['66', 'Thailand'],
  ['81', 'Japan'], ['82', 'South Korea'], ['84', 'Vietnam'], ['86', 'China (Mainland)'],
  ['90', 'Turkey'], ['91', 'India'], ['92', 'Pakistan'], ['94', 'Sri Lanka'], ['95', 'Myanmar'], ['98', 'Iran'],
  // 1-digit — checked last, so any of the above 2/3-digit codes that share
  // this prefix (there are none in this table, but keep the ordering safe)
  // would still win first.
  ['1', 'United States'], ['7', 'Russia'],
].sort((a, b) => b[0].length - a[0].length)

export function countryFromPhone(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '').replace(/^0+/, '')
  if (!digits) return ''
  for (const [code, country] of CODES) {
    if (digits.startsWith(code)) return country
  }
  return ''
}
