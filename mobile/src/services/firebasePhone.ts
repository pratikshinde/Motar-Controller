import { Platform } from 'react-native';
import { brand } from '@/config/brand';

/**
 * Sign in with Firebase Phone Authentication. Firebase sends the SMS code itself (no SMS provider or DLT registration of ours),
 * the farmer types it, and Firebase gives the app a signed ID token that the backend checks (POST /auth/firebase-phone).
 *
 * Only the Ajanta Android app has a Firebase project (app.config.js adds the library's plugin only when google-services.json is
 * present); everywhere else (tests, the web, other brands) the login screen keeps using the backend's own SMS-code route.
 */
export const firebasePhoneSupported = Platform.OS === 'android' && brand.key === 'ajanta';

export type FirebasePhoneProblem = 'wrongCode' | 'tooMany' | 'badPhone' | 'network' | 'other';

export interface PhoneChallenge {
  /** Checks the SMS code with Firebase and returns the signed ID token to give to the backend. */
  confirm: (code: string) => Promise<string>;
}

function loadAuth() {
  // Loaded only when a farmer actually signs in with Firebase: a build without the Firebase file (and the tests) never touches it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-firebase/auth') as typeof import('@react-native-firebase/auth');
  return { mod, auth: mod.getAuth() };
}

/** Asks Firebase to SMS a code to this number (E.164, "+91..."). Call again to send a new code. */
export async function startPhoneSignIn(e164: string): Promise<PhoneChallenge> {
  const { mod, auth } = loadAuth();
  const confirmation = await mod.signInWithPhoneNumber(auth, e164);
  return {
    async confirm(code: string) {
      let user: { getIdToken: (forceRefresh?: boolean) => Promise<string> } | null | undefined;
      try {
        const credential = await confirmation.confirm(code);
        user = credential?.user ?? auth.currentUser;
      } catch (err) {
        // Android can read the SMS by itself and sign the person in before they type anything; the typed code is then moot.
        if (auth.currentUser?.phoneNumber === e164) user = auth.currentUser;
        else throw err;
      }
      if (!user) throw new Error('Firebase did not return a signed-in user');
      const idToken = await user.getIdToken(true);
      // The backend gives the session from here on: Firebase's own sign-in is not needed (and must not linger for the next person).
      await mod.signOut(auth).catch(() => undefined);
      return idToken;
    },
  };
}

/** What went wrong, in terms the login screen can word for a farmer. */
export function firebaseProblem(err: unknown): FirebasePhoneProblem {
  const code = String((err as { code?: string } | null)?.code ?? '');
  if (/invalid-verification-code|code-expired|session-expired|missing-verification-code/.test(code)) return 'wrongCode';
  if (/too-many-requests|quota-exceeded/.test(code)) return 'tooMany';
  if (/invalid-phone-number|missing-phone-number/.test(code)) return 'badPhone';
  if (/network-request-failed/.test(code)) return 'network';
  return 'other';
}
