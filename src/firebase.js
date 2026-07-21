import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const storage = getStorage(app)

// auth.currentUser is NULL until Firebase has restored the session from
// IndexedDB, and that restore is asynchronous. Anything that reads it while a
// page is mounting can lose the race on a cold load and wrongly conclude the
// user is signed out — which is why "it fails the first time, then works after
// a refresh" is the shape this bug always takes: a warm load resolves auth
// before the component gets round to asking.
//
// authStateReady() resolves once the initial state is settled, signed in or
// not. Always use this instead of reading auth.currentUser at call time.
export async function authedUser() {
  await auth.authStateReady()
  return auth.currentUser
}
