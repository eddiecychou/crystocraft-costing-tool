import { onIdTokenChanged, beforeAuthStateChanged } from 'firebase/auth'
import { auth, authedUser } from './firebase'
import { galleryEndpoint } from './brandGalleryUrls'

// Native image and download requests cannot set an Authorization header. The
// HttpOnly gallery cookie is bound to a second, random browser-session cookie.
// Drop the binding synchronously on logout, including while offline.
let previousToken, session, binding
const cookiePath = '; Path=' + galleryEndpoint + '; SameSite=Strict; Secure'
function invalidate() {
  document.cookie = 'oc_gallery_binding=; Max-Age=0' + cookiePath
  if (auth.currentUser) localStorage.removeItem('oc-gallery-binding-' + auth.currentUser.uid)
  previousToken = session = binding = undefined
}
export async function gallerySession() {
  const user = await authedUser()
  if (!user) throw Error('Sign in to view Brand Gallery.')
  const token = await user.getIdToken()
  if (auth.currentUser !== user) throw Error('Gallery session changed.')
  if (previousToken !== token) {
    previousToken = token
    // All tabs for this Firebase login must share the same binding.
    binding = localStorage.getItem('oc-gallery-binding-' + user.uid) || crypto.randomUUID()
    localStorage.setItem('oc-gallery-binding-' + user.uid, binding)
    const expected = binding
    session = fetch(galleryEndpoint, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Gallery-Binding': expected },
      cache: 'no-store', credentials: 'same-origin',
    }).then(response => {
      if (!response.ok || auth.currentUser !== user || binding !== expected) throw Error('Gallery session unavailable.')
      document.cookie = 'oc_gallery_binding=' + expected + cookiePath
    }).catch(error => { if (previousToken === token) previousToken = undefined; throw error })
  }
  return session
}
export function watchGallerySession() {
  beforeAuthStateChanged(auth, next => { if (auth.currentUser && auth.currentUser.uid !== next?.uid) invalidate() })
  onIdTokenChanged(auth, user => { if (user) gallerySession().catch(() => {}); else invalidate() })
}
