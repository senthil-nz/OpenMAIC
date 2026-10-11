'use client';

/**
 * Fork-only (FORK_CHANGES.md): the login screen.
 */
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LanguageSwitcher } from '@/components/language-switcher';
import { PERMISSIONS, roleCan, type AccountSummary } from '@/lib/accounts/policy';
import { accountStrings } from '@/lib/accounts/strings';
import { refreshAccount, useAccount } from '@/lib/accounts/use-account';
import { useI18n } from '@/lib/hooks/use-i18n';

export default function LoginPage() {
  const router = useRouter();
  const { locale } = useI18n();
  const strings = accountStrings(locale);
  const { loading, enabled, account } = useAccount();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Nothing to do here when accounts are off or the visitor is already in.
  useEffect(() => {
    if (!loading && (!enabled || account)) router.replace('/');
  }, [loading, enabled, account, router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as {
          account?: AccountSummary;
        } | null;
        // Courses this browser made before logging in move to the account
        // (the project's own claim mechanism). Only for roles that own
        // courses; a refusal ("nothing to claim") changes nothing.
        if (roleCan(body?.account?.role, PERMISSIONS.courseCreate)) {
          await fetch('/api/identity/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }).catch(() => undefined);
        }
        await refreshAccount();
        router.replace('/');
        return;
      }
      setError(
        response.status === 401
          ? strings.wrongCredentials
          : response.status === 429
            ? strings.tooManyAttempts
            : strings.loginFailed,
      );
    } catch {
      setError(strings.loginFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-slate-50 to-purple-50/40 dark:from-gray-950 dark:to-gray-900">
      <div className="fixed top-4 right-4">
        <LanguageSwitcher />
      </div>
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-border/60 bg-background/90 p-8 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{strings.loginTitle}</h1>
          <p className="text-sm text-muted-foreground">{strings.loginSubtitle}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="login-username">{strings.username}</Label>
          <Input
            id="login-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="login-password">{strings.password}</Label>
          <Input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full gap-2" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          <span>{submitting ? strings.submitting : strings.submit}</span>
        </Button>

        <p className="text-center text-sm">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            {strings.continueAsGuest}
          </Link>
        </p>
      </form>
    </main>
  );
}
