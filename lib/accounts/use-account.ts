'use client';

/**
 * Fork-only (FORK_CHANGES.md): who is logged in, for client components.
 *
 * One request per page load, shared by every component that asks. `enabled`
 * is false on a deployment without accounts, where nothing account-related is
 * shown.
 */
import { useEffect, useSyncExternalStore } from 'react';

import type { AccountSummary } from './policy';

export interface AccountState {
  readonly loading: boolean;
  readonly enabled: boolean;
  /** A viewer deployment: courses are only shown here, never created or configured. */
  readonly viewer: boolean;
  readonly account: AccountSummary | null;
}

const LOADING: AccountState = { loading: true, enabled: false, viewer: false, account: null };

let current: AccountState = LOADING;
let inFlight: Promise<void> | undefined;
const listeners = new Set<() => void>();

function publish(state: AccountState) {
  current = state;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function refreshAccount(): Promise<void> {
  inFlight ??= fetch('/api/auth/me', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then(
      (body: { enabled?: boolean; viewer?: boolean; account?: AccountSummary | null } | null) => {
        publish({
          loading: false,
          enabled: !!body?.enabled,
          viewer: !!body?.viewer,
          account: body?.account ?? null,
        });
      },
    )
    .catch(() => publish({ loading: false, enabled: false, viewer: false, account: null }))
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export async function logOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  await refreshAccount();
}

export function useAccount(): AccountState {
  const state = useSyncExternalStore(
    subscribe,
    () => current,
    () => LOADING,
  );
  useEffect(() => {
    if (current.loading) void refreshAccount();
  }, []);
  return state;
}
