import { describe, expect, it } from 'vitest';

import { PERMISSIONS, type AccountRole } from '@/lib/accounts/policy';
import {
  API_RULES,
  courseIdOf,
  decideAccess,
  requirementFor,
  viewerModeEnabled,
} from '@/lib/accounts/route-policy';
import { withSessionCookie } from '@/lib/server/accounts/gate';

const outcome = (method: string, path: string, role: AccountRole | null, viewerMode = false) => {
  const decision = decideAccess(method, path, role, { viewerMode });
  return decision.outcome === 'deny' ? decision.status : decision.outcome;
};

describe('route policy', () => {
  it('keeps what every page needs open to guests', () => {
    for (const path of [
      '/api/health',
      '/api/auth/login',
      '/api/model-config',
      '/api/agents',
      '/api/courses',
      '/api/stages',
      '/api/persistence/learner-key',
    ]) {
      expect(outcome('GET', path, null), path).toBe('allow');
    }
    expect(outcome('GET', '/', null)).toBe('allow');
    expect(outcome('GET', '/login', null)).toBe('allow');
    expect(outcome('POST', '/api/persistence/runtime/sessions', null)).toBe('allow');
  });

  it('refuses a guest everything that creates, spends quota or configures', () => {
    for (const [method, path] of [
      ['POST', '/api/generation-runs'],
      ['POST', '/api/generate-classroom'],
      ['POST', '/api/chat'],
      ['POST', '/api/chat/pi'],
      ['POST', '/api/quiz-grade'],
      ['POST', '/api/pbl/v2/evaluate'],
      ['POST', '/api/generate/tts'],
      ['POST', '/api/generate/image'],
      ['POST', '/api/parse-pdf'],
      ['PUT', '/api/model-config'],
      ['POST', '/api/verify-model'],
      ['PUT', '/api/persistence/documents/stage-1'],
      ['POST', '/api/persistence/assets'],
      ['DELETE', '/api/stages/stage-1'],
      ['POST', '/api/stages/stage-1/publish'],
      ['GET', '/api/admin/users'],
      ['GET', '/api/usage'],
    ] as const) {
      expect(outcome(method, path, null), `${method} ${path}`).toBe(401);
    }
  });

  it('lets a student view and take part, and nothing more', () => {
    expect(outcome('GET', '/api/persistence/documents/stage-1', 'student')).toBe('allow');
    expect(outcome('GET', '/classroom/stage-1', 'student')).toBe('allow');
    expect(outcome('POST', '/api/chat', 'student')).toBe('allow');
    expect(outcome('POST', '/api/quiz-grade', 'student')).toBe('allow');
    expect(outcome('POST', '/api/generation-runs', 'student')).toBe(403);
    expect(outcome('PUT', '/api/persistence/documents/stage-1/stage', 'student')).toBe(403);
    expect(outcome('POST', '/api/stages/stage-1/publish', 'student')).toBe(403);
    expect(outcome('PUT', '/api/model-config', 'student')).toBe(403);
    expect(outcome('GET', '/admin/users', 'student')).toBe(403);
  });

  it('lets a teacher create and publish, but not configure or manage users', () => {
    expect(outcome('POST', '/api/generation-runs', 'teacher')).toBe('allow');
    expect(outcome('PUT', '/api/persistence/documents/stage-1', 'teacher')).toBe('allow');
    expect(outcome('POST', '/api/stages/stage-1/publish', 'teacher')).toBe('allow');
    expect(outcome('POST', '/api/generate/image', 'teacher')).toBe('allow');
    expect(outcome('PUT', '/api/model-config', 'teacher')).toBe(403);
    expect(outcome('POST', '/api/verify-model', 'teacher')).toBe(403);
    expect(outcome('POST', '/api/provider/probe-models', 'teacher')).toBe(403);
    expect(outcome('GET', '/api/admin/users', 'teacher')).toBe(403);
  });

  it('lets an admin do all of it', () => {
    for (const [method, path] of [
      ['PUT', '/api/model-config'],
      ['POST', '/api/verify-model'],
      ['GET', '/api/admin/users'],
      ['PATCH', '/api/admin/courses/stage-1'],
      ['POST', '/api/generation-runs'],
      ['GET', '/api/usage'],
    ] as const) {
      expect(outcome(method, path, 'admin'), `${method} ${path}`).toBe('allow');
    }
  });

  it('makes reading a course depend on it being public for those who cannot view all', () => {
    for (const path of [
      '/api/persistence/documents/stage-1',
      '/api/persistence/documents/stage-1/scenes/s1',
      '/api/stages/stage-1',
      '/api/stages/stage-1/scenes',
      '/api/stage-meta/stage-1',
      '/api/classroom-media/stage-1/audio/a.mp3',
      '/classroom/stage-1',
    ]) {
      expect(decideAccess('GET', path, null), path).toEqual({
        outcome: 'if-course-public',
        courseId: 'stage-1',
      });
    }
    expect(courseIdOf('/classroom/a%20b')).toBe('a b');
    expect(courseIdOf('/api/health')).toBeUndefined();
  });

  it('refuses an API route nobody listed to everyone but an admin', () => {
    expect(requirementFor('GET', '/api/brand-new-upstream-route')).toBe(PERMISSIONS.admin);
    expect(outcome('GET', '/api/brand-new-upstream-route', null)).toBe(401);
    expect(outcome('GET', '/api/brand-new-upstream-route', 'teacher')).toBe(403);
    expect(outcome('GET', '/api/brand-new-upstream-route', 'admin')).toBe('allow');
  });

  it('does not let a prefix rule match a longer route name', () => {
    // `/api/chat` must not open `/api/chatter`, nor `/api/generate` `/api/generate-classroom`.
    expect(requirementFor('POST', '/api/chatter')).toBe(PERMISSIONS.admin);
    expect(requirementFor('POST', '/api/generate-classroom')).toBe(PERMISSIONS.courseCreate);
    expect(requirementFor('GET', '/api/agents/abc')).toBe(PERMISSIONS.courseCreate);
    expect(requirementFor('GET', '/api/stages/abc/unknown')).toBe(PERMISSIONS.courseCreate);
  });

  it('has only upper-case methods in the table', () => {
    for (const rule of API_RULES) {
      if (rule.methods === '*') continue;
      for (const method of rule.methods) expect(method).toBe(method.toUpperCase());
    }
  });
});

describe('viewer mode', () => {
  it('is off unless explicitly enabled', () => {
    expect(viewerModeEnabled({})).toBe(false);
    expect(viewerModeEnabled({ OPENMAIC_VIEWER_MODE: 'true' })).toBe(true);
  });

  it('blocks creating, publishing, configuring and user management for every role', () => {
    for (const role of ['teacher', 'admin'] as const) {
      expect(outcome('POST', '/api/generation-runs', role, true)).toBe(403);
      expect(outcome('PUT', '/api/persistence/documents/stage-1', role, true)).toBe(403);
      expect(outcome('POST', '/api/stages/stage-1/publish', role, true)).toBe(403);
      expect(outcome('PUT', '/api/model-config', role, true)).toBe(403);
      expect(outcome('GET', '/api/admin/users', role, true)).toBe(403);
    }
  });

  it('still shows courses and lets students take part', () => {
    expect(outcome('GET', '/api/courses', null, true)).toBe('allow');
    expect(outcome('GET', '/api/persistence/documents/stage-1', 'student', true)).toBe('allow');
    expect(outcome('POST', '/api/chat', 'student', true)).toBe('allow');
    expect(decideAccess('GET', '/classroom/stage-1', null, { viewerMode: true }).outcome).toBe(
      'if-course-public',
    );
  });
});

describe('session cookie rewriting', () => {
  it('replaces or removes only the session cookie', () => {
    expect(withSessionCookie('a=1; openmaic_session=old; b=2', 'new')).toBe(
      'a=1; b=2; openmaic_session=new',
    );
    expect(withSessionCookie('a=1; openmaic_session=old', null)).toBe('a=1');
    expect(withSessionCookie('openmaic_session=old', null)).toBe('');
    expect(withSessionCookie(null, 'new')).toBe('openmaic_session=new');
  });
});
