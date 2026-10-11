/**
 * Fork-only (FORK_CHANGES.md): the text of the account screens.
 *
 * Kept out of `lib/i18n/locales/*.json` so an upstream resync never conflicts
 * on it. English is the fallback for a locale without an entry here.
 */
import type { AccountRole } from './policy';

const en = {
  logIn: 'Log in',
  logOut: 'Log out',
  loginTitle: 'Log in to OpenMAIC',
  loginSubtitle: 'Use the account your administrator gave you.',
  username: 'Username',
  password: 'Password',
  submit: 'Log in',
  submitting: 'Logging in…',
  wrongCredentials: 'Wrong username or password.',
  tooManyAttempts: 'Too many attempts. Wait a minute and try again.',
  loginFailed: 'Could not log in. Try again.',
  continueAsGuest: 'Continue without logging in',
  signedInAs: 'Signed in as',
  roleStudent: 'Student',
  roleTeacher: 'Teacher',
  roleAdmin: 'Admin',
};

export type AccountStrings = typeof en;

const ta: AccountStrings = {
  logIn: 'உள்நுழை',
  logOut: 'வெளியேறு',
  loginTitle: 'OpenMAIC-இல் உள்நுழையவும்',
  loginSubtitle: 'உங்கள் நிர்வாகி வழங்கிய கணக்கைப் பயன்படுத்தவும்.',
  username: 'பயனர்பெயர்',
  password: 'கடவுச்சொல்',
  submit: 'உள்நுழை',
  submitting: 'உள்நுழைகிறது…',
  wrongCredentials: 'பயனர்பெயர் அல்லது கடவுச்சொல் தவறு.',
  tooManyAttempts: 'அதிக முயற்சிகள். ஒரு நிமிடம் கழித்து மீண்டும் முயலவும்.',
  loginFailed: 'உள்நுழைய முடியவில்லை. மீண்டும் முயலவும்.',
  continueAsGuest: 'உள்நுழையாமல் தொடரவும்',
  signedInAs: 'உள்நுழைந்தவர்',
  roleStudent: 'மாணவர்',
  roleTeacher: 'ஆசிரியர்',
  roleAdmin: 'நிர்வாகி',
};

const byLocale: Record<string, AccountStrings> = { 'en-US': en, 'ta-IN': ta };

export function accountStrings(locale: string): AccountStrings {
  return byLocale[locale] ?? en;
}

export function roleLabel(strings: AccountStrings, role: AccountRole): string {
  return role === 'admin'
    ? strings.roleAdmin
    : role === 'teacher'
      ? strings.roleTeacher
      : strings.roleStudent;
}
