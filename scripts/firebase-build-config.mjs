// Public client config only. Never print values: CLI secret getters can return masks.
export function validateFirebaseBuildConfig(env) {
  const required = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']
  for (const suffix of required) {
    const name = `VITE_FIREBASE_${suffix}`
    const value = env[name]
    if (typeof value !== 'string' || !value.trim() || /\*|placeholder|undefined|redacted/i.test(value)) {
      throw new Error(`Invalid production Firebase configuration: ${name} is missing, masked or a placeholder.`)
    }
  }
  if (!/^AIza[\w-]{35}$/.test(env.VITE_FIREBASE_API_KEY)) {
    throw new Error('Invalid production Firebase configuration: VITE_FIREBASE_API_KEY has an invalid format.')
  }
  if (env.VITE_FIREBASE_PROJECT_ID !== 'crystocraft-costing') {
    throw new Error('Invalid production Firebase configuration: unexpected OC project.')
  }
}
