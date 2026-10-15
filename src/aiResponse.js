// Parse the transport envelope before any caller changes a draft or preview.
export async function readAiResponse(response) {
  let data
  try { data = await response.json() } catch { throw new Error('The AI returned an incomplete response. Please try again. Your existing copy has been kept.') }
  if (!response.ok || data?.error) throw new Error(typeof data?.error === 'string' ? data.error : 'AI writing is unavailable. Please try again. Your existing copy has been kept.')
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The AI returned an unusable response. Please try again. Your existing copy has been kept.')
  return data
}
