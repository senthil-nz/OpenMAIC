import { describe, expect, it } from 'vitest';

import { PERMISSIONS, ROLE_GRANTS, isAccountRole, roleCan } from '@/lib/accounts/policy';
import { accountsEnabled, assertAccountsConfiguration } from '@/lib/server/accounts/bootstrap';
import { hashPassword, verifyPassword } from '@/lib/server/accounts/password';
import {
  readSessionCookie,
  sessionClearCookie,
  sessionSetCookie,
  signSessionToken,
  verifySessionToken,
} from '@/lib/server/accounts/session-token';

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long';
const SESSION_ID = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

describe('account roles', () => {
  it('grants each role only what the plan allows', () => {
    expect(roleCan('student', PERMISSIONS.courseView)).toBe(true);
    expect(roleCan('student', PERMISSIONS.classParticipate)).toBe(true);
    expect(roleCan('student', PERMISSIONS.courseCreate)).toBe(false);
    expect(roleCan('student', PERMISSIONS.admin)).toBe(false);

    expect(roleCan('teacher', PERMISSIONS.courseCreate)).toBe(true);
    expect(roleCan('teacher', PERMISSIONS.coursePublish)).toBe(true);
    expect(roleCan('teacher', PERMISSIONS.admin)).toBe(false);
    expect(roleCan('teacher', PERMISSIONS.usersManage)).toBe(false);

    for (const permission of Object.values(PERMISSIONS)) {
      expect(roleCan('admin', permission)).toBe(true);
    }
  });

  it('gives a guest nothing and rejects unknown roles', () => {
    expect(roleCan(null, PERMISSIONS.courseView)).toBe(false);
    expect(roleCan(undefined, PERMISSIONS.courseView)).toBe(false);
    expect(isAccountRole('owner')).toBe(false);
    expect(Object.keys(ROLE_GRANTS).sort()).toEqual(['admin', 'student', 'teacher']);
  });
});

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterx', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts each hash and rejects malformed stored values', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$0$8$1$$')).toBe(false);
  });
});

describe('session tokens', () => {
  const future = Math.floor(Date.now() / 1000) + 3600;

  it('round-trips a signed token', async () => {
    const token = await signSessionToken(
      { sessionId: SESSION_ID, expiresAtSeconds: future, role: 'teacher' },
      SECRET,
    );
    expect(await verifySessionToken(token, SECRET)).toEqual({
      sessionId: SESSION_ID,
      expiresAtSeconds: future,
      role: 'teacher',
    });
  });

  it('rejects a changed role, a wrong secret, an expired token and junk', async () => {
    const token = await signSessionToken(
      { sessionId: SESSION_ID, expiresAtSeconds: future, role: 'student' },
      SECRET,
    );
    expect(await verifySessionToken(token.replace('.student.', '.admin.'), SECRET)).toBeNull();
    expect(await verifySessionToken(token, `${SECRET}x`)).toBeNull();
    expect(await verifySessionToken(token, '')).toBeNull();
    expect(await verifySessionToken(token, SECRET, (future + 1) * 1000)).toBeNull();
    expect(await verifySessionToken('a.b.c', SECRET)).toBeNull();
    expect(await verifySessionToken('', SECRET)).toBeNull();
  });

  it('reads and writes the cookie', () => {
    expect(readSessionCookie(null)).toBeUndefined();
    expect(readSessionCookie('anonymous_id=x; other=y')).toBeUndefined();
    expect(readSessionCookie('anonymous_id=x; openmaic_session=tok.en; other=y')).toBe('tok.en');
    expect(sessionSetCookie('t', false)).toContain('HttpOnly');
    expect(sessionSetCookie('t', false)).not.toContain('Secure');
    expect(sessionSetCookie('t', true)).toContain('; Secure');
    expect(sessionClearCookie(false)).toContain('Max-Age=0');
  });
});

describe('accounts configuration', () => {
  it('is off unless explicitly enabled', () => {
    expect(accountsEnabled({})).toBe(false);
    expect(accountsEnabled({ OPENMAIC_ACCOUNTS_ENABLED: 'false' })).toBe(false);
    expect(accountsEnabled({ OPENMAIC_ACCOUNTS_ENABLED: 'true' })).toBe(true);
    expect(accountsEnabled({ OPENMAIC_ACCOUNTS_ENABLED: '1' })).toBe(true);
  });

  it('refuses to start when enabled without a session secret', () => {
    const saved = { ...process.env };
    try {
      process.env.OPENMAIC_ACCOUNTS_ENABLED = 'true';
      delete process.env.OPENMAIC_SESSION_SECRET;
      expect(() => assertAccountsConfiguration()).toThrow(/OPENMAIC_SESSION_SECRET/);
      process.env.OPENMAIC_SESSION_SECRET = 'short';
      expect(() => assertAccountsConfiguration()).toThrow(/OPENMAIC_SESSION_SECRET/);
      process.env.OPENMAIC_SESSION_SECRET = SECRET;
      expect(() => assertAccountsConfiguration()).not.toThrow();
      process.env.OPENMAIC_ACCOUNTS_ENABLED = 'false';
      delete process.env.OPENMAIC_SESSION_SECRET;
      expect(() => assertAccountsConfiguration()).not.toThrow();
    } finally {
      process.env = saved;
    }
  });
});
