/**
 * Fork-only (FORK_CHANGES.md): the access gate the middleware runs for every
 * request when accounts are on.
 *
 * It reads the role from the signed session cookie, renews a token that is
 * past its short lifetime against the database, and applies the rule table of
 * `lib/accounts/route-policy.ts`. Everything it needs from the database it asks
 * the app's own `/api/auth/*` routes for, so it stays free of server-only
 * imports and can run at the edge.
 */
import { accountsEnabled, type AccountRole } from '@/lib/accounts/policy';
import { decideAccess, viewerModeEnabled } from '@/lib/accounts/route-policy';

import {
  SESSION_COOKIE,
  readSessionCookie,
  readSessionToken,
  sessionClearCookie,
  sessionSecret,
  sessionSetCookie,
} from './session-token';

export const INTERNAL_URL_ENV = 'OPENMAIC_INTERNAL_URL';

export interface GateRequest {
  readonly method: string;
  readonly pathname: string;
  /** The `Cookie` header the request will be forwarded with. */
  readonly cookieHeader: string | null;
  /** The origin the server answers on, for the gate's own lookups. */
  readonly origin: string;
  readonly secureCookies: boolean;
}

export type GateResult =
  | {
      readonly action: 'continue';
      /** Set when the forwarded `Cookie` header must change (`''` removes it). */
      readonly cookieHeader?: string;
      readonly setCookies: readonly string[];
    }
  | {
      readonly action: 'refuse';
      readonly status: 401 | 403 | 404 | 503;
      readonly reason: string;
      readonly setCookies: readonly string[];
    };

/** The `Cookie` header with the session cookie replaced (or dropped when `value` is `null`). */
export function withSessionCookie(cookieHeader: string | null, value: string | null): string {
  const others = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part.split('=', 1)[0] !== SESSION_COOKIE);
  if (value !== null) others.push(`${SESSION_COOKIE}=${value}`);
  return others.join('; ');
}

function internalOrigin(request: GateRequest): string {
  return (process.env[INTERNAL_URL_ENV]?.trim() || request.origin).replace(/\/+$/, '');
}

type Renewal = { token: string; role: AccountRole } | 'ended' | 'unavailable';

/** Ask the database, through the app, whether a session is still live. */
async function renewSession(request: GateRequest, token: string): Promise<Renewal> {
  try {
    const response = await fetch(`${internalOrigin(request)}/api/auth/session`, {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!response.ok) return 'unavailable';
    const body = (await response.json()) as { token?: string | null; role?: AccountRole | null };
    return body.token && body.role ? { token: body.token, role: body.role } : 'ended';
  } catch {
    return 'unavailable';
  }
}

/** Public courses change rarely; a short cache spares guests a lookup per request. */
const COURSE_CACHE_MS = 15_000;
const courseCache = new Map<string, { isPublic: boolean; at: number }>();

async function courseIsPublic(request: GateRequest, courseId: string): Promise<boolean | null> {
  const cached = courseCache.get(courseId);
  if (cached && Date.now() - cached.at < COURSE_CACHE_MS) return cached.isPublic;
  try {
    const response = await fetch(
      `${internalOrigin(request)}/api/auth/course?id=${encodeURIComponent(courseId)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return null;
    const isPublic = ((await response.json()) as { isPublic?: boolean }).isPublic === true;
    if (courseCache.size > 500) courseCache.clear();
    courseCache.set(courseId, { isPublic, at: Date.now() });
    return isPublic;
  } catch {
    return null;
  }
}

export async function accountGate(request: GateRequest): Promise<GateResult> {
  if (!accountsEnabled()) return { action: 'continue', setCookies: [] };
  // The login routes decide for themselves, and the gate's own lookups land here.
  if (request.pathname === '/api/auth' || request.pathname.startsWith('/api/auth/')) {
    return { action: 'continue', setCookies: [] };
  }

  let role: AccountRole | null = null;
  let cookieHeader: string | undefined;
  const setCookies: string[] = [];

  const token = readSessionCookie(request.cookieHeader);
  if (token !== undefined) {
    const claims = await readSessionToken(token, sessionSecret());
    if (claims && !claims.expired) {
      role = claims.role;
    } else {
      const renewal: Renewal = claims ? await renewSession(request, token) : 'ended';
      if (renewal === 'unavailable') {
        return {
          action: 'refuse',
          status: 503,
          reason: 'Could not check your login; try again',
          setCookies,
        };
      }
      if (renewal === 'ended') {
        // A forged, expired or revoked login becomes a guest, and the browser
        // is told to drop the cookie.
        cookieHeader = withSessionCookie(request.cookieHeader, null);
        setCookies.push(sessionClearCookie(request.secureCookies));
      } else {
        role = renewal.role;
        cookieHeader = withSessionCookie(request.cookieHeader, renewal.token);
        setCookies.push(sessionSetCookie(renewal.token, request.secureCookies));
      }
    }
  }

  const decision = decideAccess(request.method, request.pathname, role, {
    viewerMode: viewerModeEnabled(),
  });
  const proceed: GateResult = {
    action: 'continue',
    ...(cookieHeader === undefined ? {} : { cookieHeader }),
    setCookies,
  };
  if (decision.outcome === 'allow') return proceed;
  if (decision.outcome === 'deny') {
    return { action: 'refuse', status: decision.status, reason: decision.reason, setCookies };
  }
  const isPublic = await courseIsPublic(request, decision.courseId);
  if (isPublic === null) {
    return { action: 'refuse', status: 503, reason: 'Could not check this course', setCookies };
  }
  if (isPublic) return proceed;
  // A course that is not public looks the same as one that does not exist.
  return role
    ? { action: 'refuse', status: 404, reason: 'Course not found', setCookies }
    : { action: 'refuse', status: 401, reason: 'Log in to open this course', setCookies };
}
