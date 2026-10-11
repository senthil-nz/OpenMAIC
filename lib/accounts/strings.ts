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
  manageUsers: 'Manage users',
  catalogueTitle: 'Courses',
  catalogueEmptyGuest: 'No public courses yet. Log in to see more.',
  catalogueEmpty: 'No courses yet.',
  cataloguePublic: 'Public',
  cataloguePrivate: 'Private',
  catalogueMine: 'Yours',
  catalogueScenes: 'pages',
  catalogueLoadFailed: 'Could not load the courses.',
  makePublic: 'Make public',
  makePrivate: 'Make private',
  visibilityFailed: 'Could not change who can see this course.',
  usersTitle: 'Users',
  usersBack: 'Back to home',
  usersAdd: 'Add user',
  usersName: 'Name',
  usersRole: 'Role',
  usersStatus: 'Status',
  usersActive: 'Active',
  usersDisabled: 'Disabled',
  usersDisable: 'Disable',
  usersEnable: 'Enable',
  usersResetPassword: 'Reset password',
  usersNewPassword: 'New password (at least 10 characters)',
  usersSave: 'Save',
  usersCancel: 'Cancel',
  usersCreate: 'Create',
  usersSaved: 'Saved.',
  usersFailed: 'That did not work.',
  usersYou: 'you',
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
  manageUsers: 'பயனர்களை நிர்வகி',
  catalogueTitle: 'பாடநெறிகள்',
  catalogueEmptyGuest: 'பொதுப் பாடநெறிகள் இன்னும் இல்லை. மேலும் காண உள்நுழையவும்.',
  catalogueEmpty: 'பாடநெறிகள் இன்னும் இல்லை.',
  cataloguePublic: 'பொது',
  cataloguePrivate: 'தனிப்பட்டது',
  catalogueMine: 'உங்களுடையது',
  catalogueScenes: 'பக்கங்கள்',
  catalogueLoadFailed: 'பாடநெறிகளை ஏற்ற முடியவில்லை.',
  makePublic: 'பொதுவாக்கு',
  makePrivate: 'தனிப்பட்டதாக்கு',
  visibilityFailed: 'இந்தப் பாடநெறியை யார் காணலாம் என்பதை மாற்ற முடியவில்லை.',
  usersTitle: 'பயனர்கள்',
  usersBack: 'முகப்புக்குத் திரும்பு',
  usersAdd: 'பயனரைச் சேர்',
  usersName: 'பெயர்',
  usersRole: 'பங்கு',
  usersStatus: 'நிலை',
  usersActive: 'செயலில்',
  usersDisabled: 'முடக்கப்பட்டது',
  usersDisable: 'முடக்கு',
  usersEnable: 'இயக்கு',
  usersResetPassword: 'கடவுச்சொல்லை மீட்டமை',
  usersNewPassword: 'புதிய கடவுச்சொல் (குறைந்தது 10 எழுத்துகள்)',
  usersSave: 'சேமி',
  usersCancel: 'ரத்து',
  usersCreate: 'உருவாக்கு',
  usersSaved: 'சேமிக்கப்பட்டது.',
  usersFailed: 'அது செயல்படவில்லை.',
  usersYou: 'நீங்கள்',
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
