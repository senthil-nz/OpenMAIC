import { describe, expect, it } from 'vitest';

import {
  PHONE_LANDSCAPE_QUERY,
  PHONE_PORTRAIT_QUERY,
  readPhoneLayout,
} from '@/lib/hooks/use-phone-layout';

/** A minimal matchMedia for the two queries, from a screen size. */
function screen(width: number, height: number) {
  return (query: string) => {
    const portrait = height >= width;
    if (query === PHONE_PORTRAIT_QUERY) return portrait && width <= 639;
    if (query === PHONE_LANDSCAPE_QUERY) return !portrait && height <= 499;
    throw new Error(`unexpected query ${query}`);
  };
}

describe('readPhoneLayout', () => {
  it('recognises phones held either way', () => {
    expect(readPhoneLayout(screen(375, 812))).toBe('portrait');
    expect(readPhoneLayout(screen(360, 740))).toBe('portrait');
    expect(readPhoneLayout(screen(812, 375))).toBe('landscape');
    expect(readPhoneLayout(screen(740, 360))).toBe('landscape');
  });

  it('leaves tablets and laptops on the desktop layout', () => {
    expect(readPhoneLayout(screen(768, 1024))).toBeNull();
    expect(readPhoneLayout(screen(1024, 768))).toBeNull();
    expect(readPhoneLayout(screen(1440, 900))).toBeNull();
  });

  it('builds its media queries from the two limits', () => {
    expect(PHONE_PORTRAIT_QUERY).toBe('(max-width: 639px) and (orientation: portrait)');
    expect(PHONE_LANDSCAPE_QUERY).toBe('(max-height: 499px) and (orientation: landscape)');
  });
});
