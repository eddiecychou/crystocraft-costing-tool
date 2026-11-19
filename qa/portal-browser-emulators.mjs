import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'

// Check both endpoints before creating a test identity or writing a fixture.
export function localPortalEmulators(projectId) {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
  const storeHost = process.env.FIRESTORE_EMULATOR_HOST
  for (const host of [authHost, storeHost]) assert.match(host || '', /^127\.0\.0\.1:\d+$/)
  assert.equal(process.env.GCLOUD_PROJECT, projectId)
  return {projectId, authHost, storeHost}
}

export function createPortalEmulatorServer({projectId, authHost, storeHost}) {
  return createServer({
    configFile: false, envDir: false, publicDir: false, logLevel: 'error',
    resolve: {alias: {'@': fileURLToPath(new URL('../src', import.meta.url))}},
    esbuild: {jsx: 'automatic'},
    define: Object.fromEntries(Object.entries({
      VITE_FIREBASE_API_KEY: 'fictional-key', VITE_FIREBASE_AUTH_DOMAIN: projectId+'.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_STORAGE_BUCKET: projectId+'.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '123456', VITE_FIREBASE_APP_ID: '1:123456:web:abc',
    }).map(([k,v])=>['import.meta.env.'+k,JSON.stringify(v)])),
    server: {host: '127.0.0.1', port: 0},
    plugins: [{name:'portal-emulators',
      transformIndexHtml: {order:'pre', handler: html=>html.replace('/src/main.jsx','/@id/portal-emulator-entry')},
      resolveId(id) { if (id === 'portal-emulator-entry') return '\0portal-emulator-entry' },
      load(id) {
        if (id !== '\0portal-emulator-entry') return
        return `
          import {auth,db} from '/src/firebase.js'
          import {connectAuthEmulator} from 'firebase/auth'
          import {connectFirestoreEmulator} from 'firebase/firestore'
          connectAuthEmulator(auth, 'http://${authHost}', {disableWarnings:true})
          connectFirestoreEmulator(db,'127.0.0.1',${Number(storeHost.split(':')[1])})
          await import('/src/main.jsx')
        `
      },
    }],
  })
}
