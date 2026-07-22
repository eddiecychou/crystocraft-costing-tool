// Stand-in for src/firebase.js AND firebase/firestore when bundling pure logic
// for headless checks.
//
// mrp.js imports criticalComponents, which imports the initialised Firestore
// app and the SDK. Bundling that pulls in grpc and fails at load ("Dynamic
// require of 'process' is not supported") — long before any code under test
// runs. The requirement maths touches none of it.
//
// Every export here throws if actually called, so a check that accidentally
// depends on the database fails loudly instead of quietly returning undefined.
const nope = name => (...args) => {
  throw new Error(`qa stub: ${name}() called — this check should not touch Firestore`)
}

export const db = null
export const storage = null
export const auth = null

export const collection = nope('collection')
export const doc = nope('doc')
export const getDoc = nope('getDoc')
export const getDocs = nope('getDocs')
export const setDoc = nope('setDoc')
export const addDoc = nope('addDoc')
export const deleteDoc = nope('deleteDoc')
export const updateDoc = nope('updateDoc')
export const onSnapshot = nope('onSnapshot')
export const query = nope('query')
export const where = nope('where')
export const orderBy = nope('orderBy')
export const limit = nope('limit')
export const writeBatch = nope('writeBatch')
export const runTransaction = nope('runTransaction')
export const serverTimestamp = () => null
export const increment = nope('increment')
export const deleteField = nope('deleteField')
export const arrayUnion = nope('arrayUnion')
export const arrayRemove = nope('arrayRemove')
export const ref = nope('ref')
export const uploadBytes = nope('uploadBytes')
export const getDownloadURL = nope('getDownloadURL')

export default {}
