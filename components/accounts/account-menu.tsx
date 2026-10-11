'use client';

/**
 * Fork-only (FORK_CHANGES.md): the login link or the signed-in user's menu,
 * for the home page's top-right pill. Renders nothing while accounts are off.
 */
import Link from 'next/link';
import { LogIn, LogOut, UserRound } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { accountStrings, roleLabel } from '@/lib/accounts/strings';
import { logOut, useAccount } from '@/lib/accounts/use-account';
import { useI18n } from '@/lib/hooks/use-i18n';

const PILL_BUTTON =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all';

export function AccountMenu({ onOpen }: { onOpen?: () => void }) {
  const { locale } = useI18n();
  const { loading, enabled, account } = useAccount();
  const strings = accountStrings(locale);

  if (loading || !enabled) return null;

  const divider = <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />;

  if (!account) {
    return (
      <>
        <Link href="/login" className={PILL_BUTTON}>
          <LogIn className="w-3.5 h-3.5" />
          <span>{strings.logIn}</span>
        </Link>
        {divider}
      </>
    );
  }

  return (
    <>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (open) onOpen?.();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button className={PILL_BUTTON}>
            <UserRound className="w-3.5 h-3.5" />
            <span className="max-w-[120px] truncate">{account.displayName}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="min-w-[180px]">
          <DropdownMenuLabel className="font-normal">
            <div className="text-xs text-muted-foreground">{strings.signedInAs}</div>
            <div className="text-sm font-medium truncate">{account.username}</div>
            <div className="text-xs text-muted-foreground">{roleLabel(strings, account.role)}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer gap-2" onSelect={() => void logOut()}>
            <LogOut className="w-3.5 h-3.5" />
            <span>{strings.logOut}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {divider}
    </>
  );
}
