// AUTO-GENERATED FROM shared/ — do not edit here.
// Run `npm run sync:shared` after editing the files in shared/.
import { z } from 'zod';
import { ARCHETYPE_ORDER } from './archetypes.ts';
import { DIMENSION_ORDER } from './dimensions.ts';
import { QUESTIONS } from './questions.ts';

const QUESTION_ID_SET = new Set(QUESTIONS.map((q) => q.id));
const OPTION_IDS_BY_QUESTION = new Map(QUESTIONS.map((q) => [q.id, new Set(q.options.map((o) => o.id))]));

export const CODE_MIN_LENGTH = 6;
export const CODE_MAX_LENGTH = 64;

export const startTestSchema = z.object({
  code: z.string().trim().min(1, '请输入测试密码').max(CODE_MAX_LENGTH),
  /** Client generated idempotency key; retrying with the same value is safe. */
  requestId: z.string().uuid(),
});

export const answerSchema = z.object({
  questionId: z.string().refine((id) => QUESTION_ID_SET.has(id), { message: '题目不存在' }),
  optionId: z.string().min(1),
});

export const submitTestSchema = z.object({
  sessionId: z.string().uuid(),
  accessToken: z.string().min(20).max(200),
  scoringVersion: z.string().max(32).optional(),
  answers: z.array(answerSchema).length(QUESTIONS.length, `需要完成全部 ${QUESTIONS.length} 道题`),
});

/** Server-side legality check for every answer pair. */
export function answersAreLegal(answers: { questionId: string; optionId: string }[]): boolean {
  if (answers.length !== QUESTIONS.length) return false;
  const seen = new Set<string>();
  for (const a of answers) {
    const options = OPTION_IDS_BY_QUESTION.get(a.questionId);
    if (!options) return false;
    if (!options.has(a.optionId)) return false;
    if (seen.has(a.questionId)) return false;
    seen.add(a.questionId);
  }
  return seen.size === QUESTIONS.length;
}

export const sessionAuthSchema = z.object({
  sessionId: z.string().uuid(),
  accessToken: z.string().min(20).max(200),
});

export const sharedResultQuerySchema = z.object({
  token: z.string().min(20).max(200),
});

export const adminLoginSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(200),
});

export const adminAuthSchema = z.object({
  token: z.string().min(20).max(200),
});

export const adminCreateCodeSchema = z.object({
  label: z.string().trim().max(80).optional(),
  maxUses: z.number().int().min(1).max(100).default(3),
  note: z.string().trim().max(200).optional(),
});

export const adminUpdateCodeSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean().optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
  note: z.string().trim().max(200).optional(),
  revokeShares: z.boolean().optional(),
});

export const ARCHETYPE_IDS = ARCHETYPE_ORDER;
export const DIMENSION_IDS = DIMENSION_ORDER;
export const TOTAL_QUESTIONS = QUESTIONS.length;