'use client';

import { useEffect, useState } from 'react';

/**
 * Fork-only (FORK_CHANGES.md): whether the classroom is on a phone, and which
 * way the phone is held.
 *
 * - `portrait`: narrower than {@link PHONE_MAX_WIDTH_PX} and taller than wide.
 * - `landscape`: shorter than {@link PHONE_MAX_HEIGHT_PX} and wider than tall.
 * - `null`: anything else (laptops, tablets), and on the server: the desktop
 *   layout is unchanged there.
 *
 * The one rule both phone layouts read; changing what counts as a phone is an
 * edit to the two numbers below.
 */
export const PHONE_MAX_WIDTH_PX = 640;
export const PHONE_MAX_HEIGHT_PX = 500;

export type PhoneLayout = 'portrait' | 'landscape' | null;

export const PHONE_PORTRAIT_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX - 1}px) and (orientation: portrait)`;
export const PHONE_LANDSCAPE_QUERY = `(max-height: ${PHONE_MAX_HEIGHT_PX - 1}px) and (orientation: landscape)`;

export function readPhoneLayout(matches: (query: string) => boolean): PhoneLayout {
  if (matches(PHONE_PORTRAIT_QUERY)) return 'portrait';
  if (matches(PHONE_LANDSCAPE_QUERY)) return 'landscape';
  return null;
}

export function usePhoneLayout(): PhoneLayout {
  const [layout, setLayout] = useState<PhoneLayout>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const queries = [PHONE_PORTRAIT_QUERY, PHONE_LANDSCAPE_QUERY].map((query) =>
      window.matchMedia(query),
    );
    const update = () => setLayout(readPhoneLayout((query) => window.matchMedia(query).matches));
    update();
    for (const query of queries) query.addEventListener('change', update);
    return () => {
      for (const query of queries) query.removeEventListener('change', update);
    };
  }, []);
  return layout;
}
