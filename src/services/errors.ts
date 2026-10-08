/** Turns Firebase and validation errors into short, honest messages. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'That action isn’t allowed, or you no longer have access.';
    case 'unavailable':
    case 'deadline-exceeded':
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and try again.';
    case 'resource-exhausted':
    case 'auth/quota-exceeded':
      return 'The app has hit its free usage limit for now. Please try again later.';
    case 'failed-precondition':
      return 'The database is still being set up (an index may be building). Try again in a few minutes.';
    case 'unauthenticated':
    case 'auth/user-token-expired':
      return 'Your session expired. Please sign in again.';
    case 'auth/unauthorized-domain':
      return 'This web address isn’t authorized for sign-in yet. Add it under Firebase Authentication → Settings → Authorized domains.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in isn’t enabled for this Firebase project yet.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
  }
  if (!code && err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Errors the user caused deliberately (closing a popup) that need no message. */
export function isSilentAuthError(err: unknown): boolean {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled';
}
