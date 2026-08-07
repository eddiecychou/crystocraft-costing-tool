// Client-side enforcement of the sensitive-customer image screen.
//
// Root cause found 2026-08-07, after TWO earlier fixes both failed to close
// this leak in production: firestore.rules' products/{id}/images rule
// (viewerIsSensitive()) does NOT reliably filter LIST/QUERY results per
// document the way this whole feature assumed it would. Confirmed
// EMPIRICALLY, not by re-reading the rule text: minted a real Firebase auth
// token for Sunlife's actual portal account (firebase-admin can create a
// custom token for any uid; exchanged it for a real ID token via the Auth
// REST API) and ran the exact same Firestore "list documents" REST call the
// browser's SDK runs, against a product known to have its hero branded for
// a DIFFERENT customer (CTF Life, not Sunlife). The query returned 200 and
// included the blocked document. Firestore's get()/exists()-based rules
// reliably gate a single-document GET; they do not reliably gate what comes
// back from an unconstrained collection LIST the way a `where()` filter
// would. The rule stays as defense-in-depth for direct single-doc reads,
// but nothing here may trust that a LIST query already excluded anything.
//
// So every list of products/{id}/images this app shows a customer MUST be
// filtered again, client-side, after the fetch — belt AND suspenders,
// since we now know the "suspenders" (the rule) doesn't reliably act as a
// filter for this shape of read.
export function isImageBlockedForViewer(img, profile) {
  if (!profile?.sensitive) return false
  const tag = img?.branded_for_customer_id
  return !!tag && tag !== profile?.customer_id
}

export function screenSensitiveImages(images, profile) {
  return (images || []).filter(im => !isImageBlockedForViewer(im, profile))
}
