export function accountInformationTemplate(account) {
  const name = String(account.contact_name || '').trim().split(/\s+/)[0]
  const company = String(account.company_name || '').trim()
  return {
    subject: 'Your Crystocraft portal request',
    message: `${name ? `Dear ${name},` : 'Hello,'}\n\nThanks for requesting access to our Crystocraft portal.\n\nBefore we approve your account, could you tell us a little about ${company || 'your business'}, including your country and website or social media page?\n\nPlease also let us know which products you are interested in and whether they are for resale or a particular project. This will help us set up the right access for you.\n\nBest regards,\nEddie`,
  }
}
