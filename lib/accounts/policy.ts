/**
 * Fork-only: accounts and roles (see FORK_CHANGES.md).
 *
 * The one place that says what each account role may do. Changing who can do
 * what is an edit to {@link ROLE_GRANTS}; nothing else hard-codes a role name.
 *
 * This module has no server imports: the login screen, the route handlers and
 * the middleware all read the same table.
 */

export const ACCOUNT_ROLES = ['student', 'teacher', 'admin'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value);
}

/**
 * What an account may do. `course:publish` and `admin` are the core roles of
 * `lib/server/identity/types.ts`; the others are this fork's.
 */
export const PERMISSIONS = {
  /** Open courses that are not public. */
  courseView: 'course:view',
  /** Lesson features that call a model: class chat, quiz grading, speech. */
  classParticipate: 'class:participate',
  /** Generate, edit and delete courses. */
  courseCreate: 'course:create',
  /** Make a course public or private (core role). */
  coursePublish: 'course:publish',
  /** Model services and control settings (core role). */
  admin: 'admin',
  /** Create users, change roles, reset passwords. */
  usersManage: 'users:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const STUDENT: readonly Permission[] = [PERMISSIONS.courseView, PERMISSIONS.classParticipate];
const TEACHER: readonly Permission[] = [
  ...STUDENT,
  PERMISSIONS.courseCreate,
  PERMISSIONS.coursePublish,
];
const ADMIN: readonly Permission[] = [...TEACHER, PERMISSIONS.admin, PERMISSIONS.usersManage];

/** The permission table: one row per role. A guest (no login) holds none. */
export const ROLE_GRANTS: Readonly<Record<AccountRole, readonly Permission[]>> = {
  student: STUDENT,
  teacher: TEACHER,
  admin: ADMIN,
};

export function permissionsOf(role: AccountRole): ReadonlySet<string> {
  return new Set<string>(ROLE_GRANTS[role]);
}

export function roleCan(role: AccountRole | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_GRANTS[role].includes(permission);
}

/** Environment switch: accounts are off unless this is `true` or `1`. */
export const ACCOUNTS_ENABLED_ENV = 'OPENMAIC_ACCOUNTS_ENABLED';

/** The account as the browser sees it. Never carries a credential. */
export interface AccountSummary {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: AccountRole;
}

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
