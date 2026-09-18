// Shim for the ported Product Design modules (V8.16), which import Firebase
// handles as `@/lib/firebase`. This app's real Firebase init lives at
// src/firebase.js — there must be exactly ONE initializeApp/initializeFirestore
// in the app, so this only RE-EXPORTS those handles rather than creating a
// second app. (The `ignoreUndefinedProperties` those modules rely on is set on
// the real db in src/firebase.js.)
export { db, storage, auth } from "@/firebase";
