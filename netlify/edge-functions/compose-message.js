import { requireModule } from './lib/auth.js'

export default async (request) => {
  const auth = await requireModule(request, 'quotes')
  if (!auth.ok) return auth.response

  const { customer, product, channel, context: ctx } = await request.json()

  const channelInstructions = {
    'Email':             'Write a complete, professional email of roughly 150-250 words with a Subject: line at the top. Open with a warm greeting, develop the situation across 2-4 short paragraphs, and close with a clear next step. Sign off as "Eddie Chou, Crystocraft".',
    'WhatsApp Business': 'Write a WhatsApp Business message of roughly 100-180 words across a few short paragraphs. Conversational but professional, with enough detail to be useful. Sign off as "Eddie - Crystocraft".',
    'Alibaba':           'Write an Alibaba Trade Manager message of roughly 150-250 words. Mention verified supplier status and develop the message fully. Sign off as "Eddie, Crystocraft (Verified Gold Supplier)".',
    'Personal WhatsApp': 'Very warm and casual tone — like texting a friend you do business with. Roughly 80-140 words. Use first name only. No formal sign-off.',
  }

  const prompt = `You are Eddie Chou, owner of Crystocraft — a Hong Kong-based manufacturer of premium crystal gifts, figurines, music boxes, crystal fabric flowers, NFC coins, and custom OEM corporate gifts. Website: www.crystocraft.com.

Writing to: ${customer.contact_name || customer.company_name} at ${customer.company_name} (${customer.country || ''})
Customer segment: ${customer.segment || customer.tags?.join(', ') || 'general customer'}

Product focus: ${product}

Situation / what Eddie wants to say:
${ctx}

${channelInstructions[channel] || channelInstructions['Email']}

Rules:
- Write the message based on the situation described above — that is the primary instruction
- Be warm and genuine, not salesy or corporate
- Reference the specific product naturally where relevant
- Never make up prices — say "we'll send a competitive quotation" if pricing comes up
- Use their actual name (${customer.contact_name || customer.company_name}), not [Name] or placeholders
- NEVER start the message body with "Elevate", "Discover", "Introducing", "Transform", or "Unleash"
- Write a complete, fully developed message that hits the target length for this channel — do not cut it short or reply with just a sentence or two`

  const models = ['gemini-2.0-flash', 'gemini-2.5-flash']

  for (const model of models) {
    try {
      const generationConfig = { maxOutputTokens: 2048, temperature: 0.7 }
      // 2.5-flash spends maxOutputTokens on hidden "thinking" first, which can
      // truncate the visible message mid-sentence. Disable thinking for it.
      if (model.startsWith('gemini-2.5')) generationConfig.thinkingConfig = { thinkingBudget: 0 }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig,
          }),
        }
      )
      if (!res.ok) {
        const errText = await res.text()
        console.error(`Gemini ${model} error ${res.status}:`, errText)
        if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue }
        throw new Error(errText)
      }
      const data = await res.json()
      const message = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to generate message.'
      return new Response(JSON.stringify({ message }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (e) {
      console.error(`Gemini ${model} failed:`, e.message)
      continue
    }
  }

  return new Response(
    JSON.stringify({ error: 'Failed to generate message. Please try again.' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } }
  )
}

export const config = { path: '/api/compose-message' }
