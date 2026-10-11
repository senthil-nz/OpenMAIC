'use client';

/**
 * Fork-only (FORK_CHANGES.md): the admin's user list. Add accounts, change a
 * role, reset a password, disable or re-enable an account.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ACCOUNT_ROLES,
  PASSWORD_MIN_LENGTH,
  PERMISSIONS,
  roleCan,
  type AccountRole,
} from '@/lib/accounts/policy';
import { accountStrings, roleLabel } from '@/lib/accounts/strings';
import { useAccount } from '@/lib/accounts/use-account';
import { useI18n } from '@/lib/hooks/use-i18n';

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  active: boolean;
}

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

async function api(path: string, method: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    users?: UserRow[];
  };
  return { ok: response.ok, ...data };
}

export default function AdminUsersPage() {
  const { locale } = useI18n();
  const strings = accountStrings(locale);
  const { loading, account } = useAccount();
  const allowed = roleCan(account?.role, PERMISSIONS.usersManage);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [draft, setDraft] = useState({
    username: '',
    displayName: '',
    password: '',
    role: 'student' as AccountRole,
  });

  const load = useCallback(async () => {
    const result = await api('/api/admin/users', 'GET');
    if (result.ok && result.users) setUsers(result.users);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    void api('/api/admin/users', 'GET').then((result) => {
      if (!cancelled && result.ok && result.users) setUsers(result.users);
    });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const run = async (path: string, method: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    const result = await api(path, method, body);
    setBusy(false);
    setMessage(
      result.ok
        ? { kind: 'ok', text: strings.usersSaved }
        : { kind: 'error', text: result.error ?? strings.usersFailed },
    );
    if (result.ok) await load();
    return result.ok;
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run('/api/admin/users', 'POST', {
      username: draft.username,
      password: draft.password,
      role: draft.role,
      ...(draft.displayName.trim() ? { displayName: draft.displayName } : {}),
    });
    if (ok) setDraft({ username: '', displayName: '', password: '', role: 'student' });
  };

  const patch = (id: string, change: Record<string, unknown>) =>
    run(`/api/admin/users/${encodeURIComponent(id)}`, 'PATCH', change);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }
  // The server already refuses everyone else; this only avoids an empty page.
  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Link href="/" className="text-sm underline">
          {strings.usersBack}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{strings.usersBack}</span>
      </Link>
      <h1 className="mb-6 text-2xl font-semibold">{strings.usersTitle}</h1>

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={
            message.kind === 'error'
              ? 'mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400'
              : 'mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/50 dark:text-green-400'
          }
        >
          {message.text}
        </p>
      )}

      <form
        onSubmit={(event) => void create(event)}
        className="mb-8 grid gap-3 rounded-xl border border-border/60 p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="space-y-1">
          <Label htmlFor="new-username">{strings.username}</Label>
          <Input
            id="new-username"
            required
            autoCapitalize="none"
            spellCheck={false}
            value={draft.username}
            onChange={(event) => setDraft({ ...draft, username: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-name">{strings.usersName}</Label>
          <Input
            id="new-name"
            value={draft.displayName}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-password">{strings.password}</Label>
          <Input
            id="new-password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-role">{strings.usersRole}</Label>
          <select
            id="new-role"
            className={`${SELECT_CLASS} w-full`}
            value={draft.role}
            onChange={(event) => setDraft({ ...draft, role: event.target.value as AccountRole })}
          >
            {ACCOUNT_ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabel(strings, role)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={busy} className="w-full gap-2">
            <UserPlus className="h-4 w-4" />
            <span>{strings.usersAdd}</span>
          </Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{strings.username}</th>
              <th className="px-3 py-2 font-medium">{strings.usersName}</th>
              <th className="px-3 py-2 font-medium">{strings.usersRole}</th>
              <th className="px-3 py-2 font-medium">{strings.usersStatus}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-border/60 align-middle">
                <td className="px-3 py-2 font-medium">
                  {user.username}
                  {user.id === account?.id && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      ({strings.usersYou})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{user.displayName}</td>
                <td className="px-3 py-2">
                  <select
                    aria-label={strings.usersRole}
                    className={SELECT_CLASS}
                    disabled={busy}
                    value={user.role}
                    onChange={(event) => void patch(user.id, { role: event.target.value })}
                  >
                    {ACCOUNT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(strings, role)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {user.active ? strings.usersActive : strings.usersDisabled}
                </td>
                <td className="px-3 py-2">
                  {resetFor === user.id ? (
                    <form
                      className="flex flex-wrap items-center justify-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void patch(user.id, { password: resetPassword }).then((ok) => {
                          if (ok) {
                            setResetFor(null);
                            setResetPassword('');
                          }
                        });
                      }}
                    >
                      <Input
                        type="password"
                        required
                        minLength={PASSWORD_MIN_LENGTH}
                        autoComplete="new-password"
                        aria-label={strings.usersNewPassword}
                        placeholder={strings.usersNewPassword}
                        className="h-8 w-56"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                      />
                      <Button type="submit" size="sm" disabled={busy}>
                        <span>{strings.usersSave}</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setResetFor(null);
                          setResetPassword('');
                        }}
                      >
                        <span>{strings.usersCancel}</span>
                      </Button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setResetFor(user.id);
                          setResetPassword('');
                        }}
                      >
                        <span>{strings.usersResetPassword}</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void patch(user.id, { active: !user.active })}
                      >
                        <span>{user.active ? strings.usersDisable : strings.usersEnable}</span>
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
