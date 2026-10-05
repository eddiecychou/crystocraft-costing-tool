import { stdin, stdout } from 'node:process'
import { apiKey, keychain } from './auth.mjs'

function hiddenQuestion(label) {
  if (!stdin.isTTY) throw new Error('Interactive terminal required for password input')
  return new Promise((resolve, reject) => {
    stdout.write(label)
    let answer = ''
    stdin.setRawMode(true)
    stdin.resume()
    const finish = () => { stdin.setRawMode(false); stdin.pause(); stdout.write('\n') }
    const onData = chunk => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') { stdin.off('data', onData); finish(); resolve(answer); return }
        if (char === '\u0003') { stdin.off('data', onData); finish(); reject(new Error('Cancelled')); return }
        if (char === '\u007f') answer = answer.slice(0, -1)
        else answer += char
      }
    }
    stdin.on('data', onData)
  })
}

try {
  const email = (await hiddenQuestion('Operation Center email (hidden): ')).trim()
  if (!email) throw new Error('Email is required')
  const password = await hiddenQuestion('Password (hidden): ')
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.refreshToken) throw new Error('Sign-in failed; check your account, password, and Firebase API key')
  await keychain('write', data.refreshToken)
  stdout.write(`Saved a renewable user session in macOS Keychain for ${data.email || email}. No password was saved.\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
