/**
 * Fork-only (FORK_CHANGES.md): which role each route needs.
 *
 * One table, read top to bottom, first match wins. To change who may do
 * something, edit its row here (or the role's permissions in `./policy.ts`).
 * An API route that matches no row is refused for everyone but an admin, so a
 * route added upstream is never open by accident.
 *
 * No server imports: the middleware evaluates this at the edge.
 */
import { PERMISSIONS, roleCan, type AccountRole, type Permission } from './policy';

/**
 * - `public`: anyone, logged in or not.
 * - `login`: any logged-in account.
 * - a permission: accounts whose role holds it.
 * - `course`: anyone may open a public course; a course that is not public
 *   needs `course:view`. The course id is the path segment after the prefix.
 */
export type Requirement = 'public' | 'login' | 'course' | Permission;

interface Rule {
  /** Upper-case HTTP methods, or `*`. */
  readonly methods: readonly string[] | '*';
  /** Path prefix (matches the path itself and anything below it) or a pattern. */
  readonly path: string | RegExp;
  readonly needs: Requirement;
}

const READ = ['GET', 'HEAD', 'OPTIONS'] as const;
const P = PERMISSIONS;

export const API_RULES: readonly Rule[] = [
  // --- Always open -----------------------------------------------------------
  { methods: '*', path: '/api/auth', needs: 'public' },
  { methods: '*', path: '/api/access-code', needs: 'public' },
  { methods: READ, path: '/api/health', needs: 'public' },
  // What the interface reads on every page to know what the server offers.
  { methods: READ, path: '/api/model-config', needs: 'public' },
  { methods: READ, path: '/api/server-providers', needs: 'public' },
  { methods: READ, path: '/api/generate-classroom/capabilities', needs: 'public' },
  { methods: READ, path: '/api/export-video/capability', needs: 'public' },
  { methods: READ, path: '/api/agent/runtime', needs: 'public' },
  { methods: READ, path: /^\/api\/agents$/, needs: 'public' },
  { methods: READ, path: '/api/courses', needs: 'public' },

  // --- Model and control settings: admin only --------------------------------
  { methods: '*', path: '/api/model-config', needs: P.admin },
  { methods: '*', path: /^\/api\/verify-[a-z-]+$/, needs: P.admin },
  { methods: '*', path: '/api/provider', needs: P.admin },
  { methods: '*', path: '/api/azure-voices', needs: P.admin },
  { methods: '*', path: '/api/usage', needs: P.admin },
  { methods: '*', path: '/api/admin', needs: P.usersManage },

  // --- Reading a course: public for public courses ---------------------------
  { methods: READ, path: /^\/api\/stages\/[^/]+\/status$/, needs: 'public' },
  {
    methods: READ,
    path: /^\/api\/stages\/[^/]+(\/(manifest|scenes|freshness))?$/,
    needs: 'course',
  },
  { methods: READ, path: /^\/api\/stage-meta\/[^/]+$/, needs: 'course' },
  { methods: READ, path: /^\/api\/classroom-media\/[^/]+\//, needs: 'course' },
  { methods: READ, path: /^\/api\/persistence\/documents\/[^/]+/, needs: 'course' },

  // --- A learner's own progress and the media a course shows -----------------
  { methods: '*', path: '/api/persistence/runtime', needs: 'public' },
  { methods: READ, path: '/api/persistence/learner-key', needs: 'public' },
  { methods: READ, path: '/api/persistence/assets', needs: 'public' },
  // The caller's own generation runs: the home page polls this for everyone,
  // and the handlers only ever answer with the caller's own (none for a guest).
  { methods: READ, path: '/api/generation-runs', needs: 'public' },
  // The caller's own library and folders (empty for a guest).
  { methods: READ, path: /^\/api\/stages$/, needs: 'public' },
  { methods: READ, path: /^\/api\/folders$/, needs: 'public' },

  // --- Lesson features that spend model quota --------------------------------
  { methods: '*', path: '/api/chat', needs: P.classParticipate },
  { methods: '*', path: '/api/quiz-grade', needs: P.classParticipate },
  { methods: '*', path: '/api/pbl', needs: P.classParticipate },
  { methods: '*', path: '/api/transcription', needs: P.classParticipate },
  { methods: '*', path: '/api/generate/tts', needs: P.classParticipate },

  // --- Publishing ------------------------------------------------------------
  { methods: '*', path: /^\/api\/stages\/[^/]+\/(publish|unpublish)$/, needs: P.coursePublish },

  // --- Moving pre-login work into an account ---------------------------------
  { methods: '*', path: '/api/identity', needs: 'login' },

  // --- Creating and changing courses -----------------------------------------
  { methods: '*', path: '/api/generation-runs', needs: P.courseCreate },
  { methods: '*', path: '/api/generate-classroom', needs: P.courseCreate },
  { methods: '*', path: '/api/generate', needs: P.courseCreate },
  { methods: '*', path: '/api/stages', needs: P.courseCreate },
  { methods: '*', path: '/api/folders', needs: P.courseCreate },
  { methods: '*', path: '/api/materials', needs: P.courseCreate },
  { methods: '*', path: '/api/agents', needs: P.courseCreate },
  { methods: '*', path: '/api/agent', needs: P.courseCreate },
  { methods: '*', path: '/api/skills', needs: P.courseCreate },
  { methods: '*', path: '/api/parse-pdf', needs: P.courseCreate },
  { methods: '*', path: '/api/proxy-media', needs: P.courseCreate },
  { methods: '*', path: '/api/export-video', needs: P.courseCreate },
  { methods: '*', path: '/api/comfyui-workflows', needs: P.courseCreate },
  { methods: '*', path: '/api/persistence', needs: P.courseCreate },
];

export const PAGE_RULES: readonly Rule[] = [
  { methods: '*', path: '/login', needs: 'public' },
  { methods: '*', path: /^\/classroom\/[^/]+/, needs: 'course' },
  { methods: '*', path: '/admin', needs: P.usersManage },
  { methods: '*', path: '/workbench', needs: P.courseCreate },
  { methods: '*', path: '/workspace', needs: P.courseCreate },
  { methods: '*', path: '/generation-preview', needs: P.courseCreate },
];

/**
 * Viewer mode (`OPENMAIC_VIEWER_MODE=true`): a deployment that only shows
 * courses. Nobody creates, edits, generates or configures on it, whatever
 * their role; courses and accounts are managed from an authoring deployment
 * on the same database.
 */
const VIEWER_BLOCKED: ReadonlySet<Requirement> = new Set<Requirement>([
  P.courseCreate,
  P.coursePublish,
  P.admin,
  P.usersManage,
]);

function matches(rule: Rule, method: string, pathname: string): boolean {
  if (rule.methods !== '*' && !rule.methods.includes(method)) return false;
  if (typeof rule.path !== 'string') return rule.path.test(pathname);
  return pathname === rule.path || pathname.startsWith(`${rule.path}/`);
}

/** What a request needs, by the first matching row. */
export function requirementFor(method: string, pathname: string): Requirement {
  const upper = method.toUpperCase();
  const isApi = pathname === '/api' || pathname.startsWith('/api/');
  const rule = (isApi ? API_RULES : PAGE_RULES).find((r) => matches(r, upper, pathname));
  if (rule) return rule.needs;
  // Unlisted API routes are admin-only; unlisted pages (the home page) are open.
  return isApi ? P.admin : 'public';
}

/** The course id a `course` requirement is about. */
export function courseIdOf(pathname: string): string | undefined {
  const match =
    /^\/api\/(?:stages|stage-meta|classroom-media|persistence\/documents)\/([^/]+)/.exec(
      pathname,
    ) ?? /^\/classroom\/([^/]+)/.exec(pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export type AccessDecision =
  | { readonly outcome: 'allow' }
  /** Allowed only if the named course is public. */
  | { readonly outcome: 'if-course-public'; readonly courseId: string }
  /** `401`: logging in could help. `403`: this account may not. */
  | { readonly outcome: 'deny'; readonly status: 401 | 403; readonly reason: string };

export function decideAccess(
  method: string,
  pathname: string,
  role: AccountRole | null,
  options: { viewerMode?: boolean } = {},
): AccessDecision {
  const needs = requirementFor(method, pathname);
  if (needs === 'public') return { outcome: 'allow' };

  const refuse = (reason: string): AccessDecision => ({
    outcome: 'deny',
    status: role ? 403 : 401,
    reason,
  });

  if (options.viewerMode && VIEWER_BLOCKED.has(needs)) {
    return { outcome: 'deny', status: 403, reason: 'This deployment only shows courses' };
  }
  if (needs === 'login') return role ? { outcome: 'allow' } : refuse('Log in to continue');
  if (needs === 'course') {
    if (roleCan(role, P.courseView)) return { outcome: 'allow' };
    const courseId = courseIdOf(pathname);
    return courseId
      ? { outcome: 'if-course-public', courseId }
      : refuse('Log in to open this course');
  }
  return roleCan(role, needs) ? { outcome: 'allow' } : refuse('Your account cannot do this');
}

export const VIEWER_MODE_ENV = 'OPENMAIC_VIEWER_MODE';

export function viewerModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[VIEWER_MODE_ENV]?.trim().toLowerCase();
  return value === 'true' || value === '1';
}
