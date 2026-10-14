export function loginErrorMessage(error) {
  switch (error?.code) {
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
    case 'auth/operation-not-allowed':
      return 'Sign-in is unavailable because of a site configuration problem. Please contact support; do not reset your password.'
    case 'auth/network-request-failed':
      return 'Could not connect to sign-in. Check your connection and try again.'
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Please wait and try again.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password.'
    default:
      return 'Could not sign in. Please try again or contact support.'
  }
}
