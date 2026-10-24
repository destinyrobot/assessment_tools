import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import {
  CODE_MAX_LENGTH,
  answersAreLegal,
  adminCreateCodeSchema,
  adminLoginSchema,
  sharedResultQuerySchema,
  startTestSchema,
  submitTestSchema,
} from '@shared/schemas.ts';
import { QUESTIONS } from '@shared/questions.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const complete = QUESTIONS.map((q) => ({ questionId: q.id, optionId: q.options[0].id }));
const uuid = '11111111-1111-4111-8111-111111111111';

describe('startTestSchema', () => {
  it('accepts a well formed request', () => {
    expect(startTestSchema.safeParse({ code: 'ABCD-EFGH', requestId: uuid }).success).toBe(true);
  });

  it('rejects empty codes, long codes and bad request ids', () => {
    expect(startTestSchema.safeParse({ code: '', requestId: uuid }).success).toBe(false);
    expect(startTestSchema.safeParse({ code: 'x'.repeat(CODE_MAX_LENGTH + 1), requestId: uuid }).success).toBe(
      false,
    );
    expect(startTestSchema.safeParse({ code: 'ABCD', requestId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('answersAreLegal', () => {
  it('accepts a full, legal set', () => {
    expect(answersAreLegal(complete)).toBe(true);
  });

  it('rejects missing questions', () => {
    expect(answersAreLegal(complete.slice(0, 23))).toBe(false);
  });

  it('rejects unknown question ids', () => {
    expect(answersAreLegal([...complete.slice(0, 23), { questionId: 'qXX', optionId: 'a' }])).toBe(false);
  });

  it('rejects an option that does not belong to its question', () => {
    const bad = complete.map((a) => (a.questionId === 'q01' ? { ...a, optionId: 'z' } : a));
    expect(answersAreLegal(bad)).toBe(false);
  });

  it('rejects duplicates even when the length is right', () => {
    const dup = [...complete];
    dup[1] = { ...dup[0] };
    expect(answersAreLegal(dup)).toBe(false);
  });
});

describe('submitTestSchema', () => {
  const base = { sessionId: uuid, accessToken: 'a'.repeat(40), answers: complete };

  it('accepts a complete submission', () => {
    expect(submitTestSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an incomplete submission', () => {
    expect(submitTestSchema.safeParse({ ...base, answers: complete.slice(0, 20) }).success).toBe(false);
  });

  it('rejects a short access token', () => {
    expect(submitTestSchema.safeParse({ ...base, accessToken: 'short' }).success).toBe(false);
  });
});

describe('share + admin schemas', () => {
  it('validates the share token', () => {
    expect(sharedResultQuerySchema.safeParse({ token: 'a'.repeat(32) }).success).toBe(true);
    expect(sharedResultQuerySchema.safeParse({ token: 'short' }).success).toBe(false);
  });

  it('validates admin credentials', () => {
    expect(adminLoginSchema.safeParse({ username: 'admin', password: 'longenough1' }).success).toBe(true);
    expect(adminLoginSchema.safeParse({ username: 'ad', password: 'longenough1' }).success).toBe(false);
    expect(adminLoginSchema.safeParse({ username: 'admin', password: 'short' }).success).toBe(false);
  });

  it('defaults maxUses to 3 and clamps nonsense', () => {
    expect(adminCreateCodeSchema.parse({}).maxUses).toBe(3);
    expect(adminCreateCodeSchema.safeParse({ maxUses: 0 }).success).toBe(false);
    expect(adminCreateCodeSchema.safeParse({ maxUses: 999 }).success).toBe(false);
  });
});

describe('edge function bundles stay in sync with shared/', () => {
  const canonical = readdirSync(join(root, 'shared')).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );

  it('copies every canonical module into supabase/functions/_shared', async () => {
    for (const file of canonical) {
      const source = await readFile(join(root, 'shared', file), 'utf8');
      let copy: string;
      try {
        copy = await readFile(join(root, 'supabase/functions/_shared', file), 'utf8');
      } catch {
        throw new Error(`supabase/functions/_shared/${file} is missing — run "npm run sync:shared"`);
      }
      expect(copy).toContain(source);
    }
  });
});