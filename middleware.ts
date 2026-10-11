import { NextRequest, NextResponse } from 'next/server';

import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { verifyAccessTokenEdge } from '@/lib/server/access-token-edge';
import { accountGate } from '@/lib/server/accounts/gate';
import {
  anonymousOwnerForNavigation,
  type NavigationIdentity,
} from '@/lib/server/identity/navigation';

/**
 * Let the request through, carrying the anonymous owner a page request
 * establishes: the cookie is set on the page response, and the forwarded
 * request carries it too, so the page and every request it sends resolve one
 * owner (see `lib/server/identity/navigation.ts`).
 */
function next(
  request: NextRequest,
  identity: NavigationIdentity | undefined,
  account?: AccountPass,
): NextResponse {
  const accountCookie = account?.cookieHeader;
  // Forward the request untouched unless a cookie it carries has to change.
  let response: NextResponse;
  if (!identity && accountCookie === undefined) {
    response = NextResponse.next();
  } else {
    const headers = new Headers(request.headers);
    if (identity) headers.set('cookie', identity.requestCookie);
    if (accountCookie !== undefined) {
      if (accountCookie === '') headers.delete('cookie');
      else headers.set('cookie', accountCookie);
    }
    response = NextResponse.next({ request: { headers } });
  }
  if (identity) response.headers.append('set-cookie', identity.setCookie);
  for (const value of account?.setCookies ?? []) response.headers.append('set-cookie', value);
  return response;
}

/** Fork-only (FORK_CHANGES.md): what the account gate changes on a request it lets through. */
interface AccountPass {
  readonly cookieHeader?: string;
  readonly setCookies: readonly string[];
}

/**
 * Fork-only (FORK_CHANGES.md): accounts and roles. Applies the rule table of
 * `lib/accounts/route-policy.ts`; does nothing unless
 * `OPENMAIC_ACCOUNTS_ENABLED=true`. Returns a response for a refused request.
 */
async function applyAccountGate(
  request: NextRequest,
  identity: NavigationIdentity | undefined,
): Promise<AccountPass | NextResponse> {
  const { pathname } = request.nextUrl;
  const result = await accountGate({
    method: request.method,
    pathname,
    cookieHeader: identity?.requestCookie ?? request.headers.get('cookie'),
    origin: request.nextUrl.origin,
    secureCookies: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '0',
  });
  if (result.action === 'continue') return result;

  let response: NextResponse;
  if (pathname.startsWith('/api/')) {
    response = NextResponse.json(
      {
        success: false,
        errorCode: result.status === 401 ? 'UNAUTHENTICATED' : 'INVALID_REQUEST',
        error: result.reason,
      },
      { status: result.status },
    );
  } else {
    // A page a guest may not open goes to the login screen; one an account
    // may not open goes home.
    const target = request.nextUrl.clone();
    target.pathname = result.status === 401 ? '/login' : '/';
    target.search = '';
    response = NextResponse.redirect(target);
  }
  for (const value of result.setCookies) response.headers.append('set-cookie', value);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Return an actual server-side 404 when either half of the workbench is off.
  // Edge middleware cannot reliably inspect server-only deployment variables,
  // so it enforces the public gate and leaves the complete runtime/database
  // check to Node. A Node-hosted middleware uses the same gate as startup.
  const canInspectServerRuntime = process.env.NEXT_RUNTIME !== 'edge';
  const workbenchEnabled =
    isProWorkbenchEnabled() && (!canInspectServerRuntime || isAgentRuntimeConfigured());
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  // One anonymous owner per browser, established on the page response before
  // any API request can mint its own.
  const identity = anonymousOwnerForNavigation({
    method: request.method,
    headers: request.headers,
    pathname,
  });

  const account = await applyAccountGate(request, identity);
  if (account instanceof NextResponse) return account;

  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return next(request, identity, account);
  }

  // Whitelist: access-code endpoints, health check
  if (pathname.startsWith('/api/access-code/') || pathname === '/api/health') {
    return next(request, identity, account);
  }

  // Check cookie — validate HMAC signature, not just existence
  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && (await verifyAccessTokenEdge(cookie.value, accessCode))) {
    return next(request, identity, account);
  }

  // API requests without valid cookie → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  // Page requests → let through, frontend shows modal
  return next(request, identity, account);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
