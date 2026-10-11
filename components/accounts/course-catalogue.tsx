'use client';

/**
 * Fork-only (FORK_CHANGES.md): the courses a visitor may open, on the home
 * page. A guest sees the public ones; a logged-in account sees every finished
 * course. Whoever may change a course's visibility gets a switch for it.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Globe, Lock } from 'lucide-react';

import { PERMISSIONS, roleCan } from '@/lib/accounts/policy';
import { accountStrings } from '@/lib/accounts/strings';
import { useAccount } from '@/lib/accounts/use-account';
import { useI18n } from '@/lib/hooks/use-i18n';

interface CatalogueCourse {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  mine: boolean;
  sceneCount: number;
  updatedAt: number;
}

export function CourseCatalogue() {
  const { locale } = useI18n();
  const strings = accountStrings(locale);
  const { account, viewer } = useAccount();
  const role = account?.role;

  const [courses, setCourses] = useState<CatalogueCourse[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<CatalogueCourse[] | null> => {
    try {
      const response = await fetch('/api/courses', { cache: 'no-store' });
      if (!response.ok) return null;
      return ((await response.json()) as { courses: CatalogueCourse[] }).courses;
    } catch {
      return null;
    }
  }, []);

  const show = useCallback(
    (loaded: CatalogueCourse[] | null) => {
      if (loaded) setCourses(loaded);
      setError(loaded ? '' : strings.catalogueLoadFailed);
    },
    [strings.catalogueLoadFailed],
  );

  // Reload when the visitor logs in or out: the list depends on who asks.
  const accountId = account?.id;
  useEffect(() => {
    let cancelled = false;
    void load().then((loaded) => {
      if (!cancelled) show(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [load, show, accountId]);

  const isAdmin = roleCan(role, PERMISSIONS.usersManage);
  const mayChange = (course: CatalogueCourse) =>
    !viewer && (isAdmin || (course.mine && roleCan(role, PERMISSIONS.coursePublish)));

  const setVisibility = async (course: CatalogueCourse, isPublic: boolean) => {
    setBusyId(course.id);
    try {
      const response = isAdmin
        ? await fetch(`/api/admin/courses/${encodeURIComponent(course.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isPublic }),
          })
        : await fetch(
            `/api/stages/${encodeURIComponent(course.id)}/${isPublic ? 'publish' : 'unpublish'}`,
            { method: 'POST' },
          );
      if (!response.ok) throw new Error(String(response.status));
      show(await load());
    } catch {
      setError(strings.visibilityFailed);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-8 w-full text-left">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <BookOpen className="h-4 w-4" />
        <span>{strings.catalogueTitle}</span>
      </h2>

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {courses && courses.length === 0 && (
        <p className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          {account ? strings.catalogueEmpty : strings.catalogueEmptyGuest}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {(courses ?? []).map((course) => (
          <li
            key={course.id}
            className="flex flex-col gap-2 rounded-xl border border-border/60 bg-white/80 p-4 shadow-sm dark:bg-slate-900/80"
          >
            <Link
              href={`/classroom/${encodeURIComponent(course.id)}`}
              className="font-medium leading-snug hover:underline"
            >
              {course.name || course.id}
            </Link>
            {course.description && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{course.description}</p>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5">
                {course.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                <span>{course.isPublic ? strings.cataloguePublic : strings.cataloguePrivate}</span>
              </span>
              <span>
                {course.sceneCount} {strings.catalogueScenes}
              </span>
              {course.mine && <span>· {strings.catalogueMine}</span>}
              {mayChange(course) && (
                <button
                  type="button"
                  disabled={busyId === course.id}
                  onClick={() => void setVisibility(course, !course.isPublic)}
                  className="ml-auto rounded-full border border-border/60 px-2.5 py-0.5 font-medium hover:bg-muted disabled:opacity-50"
                >
                  <span>{course.isPublic ? strings.makePrivate : strings.makePublic}</span>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
