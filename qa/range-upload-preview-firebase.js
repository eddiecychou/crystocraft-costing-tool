// Local emulator harness only. Never imported by the application entry point.
import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
if (!['localhost','127.0.0.1'].includes(window.location.hostname)) throw Error('Local emulator fixture only')
const app=initializeApp({projectId:'demo-range-mcp',apiKey:'emulator-only',storageBucket:'demo-range-mcp.appspot.com'})
export const db=getFirestore(app)
connectFirestoreEmulator(db,'127.0.0.1',18121,{mockUserToken:{sub:'range-owner-admin',user_id:'range-owner-admin',email:'emulator-owner@example.test'}})
export const storage=getStorage(app)
connectStorageEmulator(storage,'127.0.0.1',19121,{mockUserToken:{sub:'range-owner-admin',user_id:'range-owner-admin'}})
export const auth={currentUser:null}
export async function authedUser(){throw Error('Emulator fixture does not call hosted endpoints')}
export async function authHeader(){throw Error('Emulator fixture does not call hosted endpoints')}
