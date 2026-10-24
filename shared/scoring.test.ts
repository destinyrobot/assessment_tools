import { describe, expect, it } from 'vitest';
import {
  DIMENSION_ORDER,
  QUESTIONS,
  ScoringError,
  accumulateWeights,
  archetypeAffinities,
  buildReport,
  isValidOption,
  pickArchetypes,
  scoreDimensions,
  strongestDimension,
  validateAnswers,
  weakestDimension,
} from './scoring.ts';
import { ARCHETYPE_ORDER } from './archetypes.ts';
import type { Answer } from './types.ts';

const optionFor = (questionId: string, index: number): Answer => ({
  questionId,
  optionId: QUESTIONS.find((q) => q.id === questionId)!.options[index].id,
});

/** Builds a complete answer set by always picking the given option index. */
function answerSet(pick: (questionId: string, i: number) => number): Answer[] {
  return QUESTIONS.map((q, i) => optionFor(q.id, pick(q.id, i)));
}

const allFirst = answerSet(() => 0);
const allSecond = answerSet(() => 1);
const allThird = answerSet(() => 2);
const allFourth = answerSet(() => 3);

describe('question bank integrity', () => {
  it('has exactly 24 questions with unique ids', () => {
    expect(QUESTIONS).toHaveLength(24);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(24);
  });

  it('gives every question exactly four options', () => {
    for (const q of QUESTIONS) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options.map((o) => o.id)).size).toBe(4);
    }
  });

  it('uses only weights in [-2, 2] on known dimensions', () => {
    for (const q of QUESTIONS) {
      for (const option of q.options) {
        for (const [dim, value] of Object.entries(option.weights)) {
          expect(DIMENSION_ORDER).toContain(dim);
          expect(Number.isInteger(value)).toBe(true);
          expect(Math.abs(value)).toBeLessThanOrEqual(2);
          expect(value).not.toBe(0);
        }
      }
    }
  });

  it('covers all eight dimensions across the bank', () => {
    const seen = new Set<string>();
    for (const q of QUESTIONS) {
      for (const option of q.options) for (const dim of Object.keys(option.weights)) seen.add(dim);
    }
    expect([...seen].sort()).toEqual([...DIMENSION_ORDER].sort());
  });
});

describe('validateAnswers', () => {
  it('accepts a complete answer set', () => {
    expect(() => validateAnswers(allFirst)).not.toThrow();
  });

  it('rejects an unknown question id', () => {
    const broken = [...allFirst];
    broken[3] = { questionId: 'q999', optionId: 'a' };
    expect(() => validateAnswers(broken)).toThrowError(ScoringError);
    try {
      validateAnswers(broken);
    } catch (e) {
      expect((e as ScoringError).code).toBe('unknown_question');
    }
  });

  it('rejects an option that belongs to a different question', () => {
    const broken = [...allFirst];
    broken[0] = { questionId: 'q01', optionId: 'd' }; // valid for q01
    broken[1] = { questionId: 'q02', optionId: 'z' };
    try {
      validateAnswers(broken);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ScoringError).code).toBe('invalid_option');
    }
  });

  it('rejects an incomplete answer set', () => {
    try {
      validateAnswers(allFirst.slice(0, 23));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ScoringError).code).toBe('incomplete_answers');
    }
  });

  it('rejects duplicated questions', () => {
    const broken = [...allFirst];
    broken[5] = { questionId: broken[4].questionId, optionId: broken[4].optionId };
    try {
      validateAnswers(broken);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ScoringError).code).toBe('duplicate_answer');
    }
  });

  it('rejects malformed entries', () => {
    try {
      validateAnswers([{ questionId: 1 } as unknown as Answer]);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ScoringError).code).toBe('invalid_answer_shape');
    }
  });
});

describe('isValidOption', () => {
  it('accepts real pairs and rejects fake ones', () => {
    expect(isValidOption('q01', 'a')).toBe(true);
    expect(isValidOption('q01', 'z')).toBe(false);
    expect(isValidOption('nope', 'a')).toBe(false);
  });
});

describe('scoreDimensions', () => {
  it('always produces eight scores in [0, 100]', () => {
    for (const set of [allFirst, allSecond, allThird, allFourth]) {
      const scores = scoreDimensions(set);
      for (const dim of DIMENSION_ORDER) {
        expect(scores[dim]).toBeGreaterThanOrEqual(0);
        expect(scores[dim]).toBeLessThanOrEqual(100);
      }
    }
  });

  it('is deterministic: the same answers always give the same scores', () => {
    const a = scoreDimensions(allSecond);
    const b = scoreDimensions(allSecond);
    expect(a).toEqual(b);
  });

  it('is stable under reordering of the answer array', () => {
    const shuffled = [...allSecond].reverse();
    expect(scoreDimensions(shuffled)).toEqual(scoreDimensions(allSecond));
  });

  it('normalises pos/neg pressure into a percentage', () => {
    const { positive, negative } = accumulateWeights(allFirst);
    for (const dim of DIMENSION_ORDER) {
      const total = positive[dim] + negative[dim];
      if (total === 0) {
        expect(scoreDimensions(allFirst)[dim]).toBe(50);
      } else {
        expect(scoreDimensions(allFirst)[dim]).toBeCloseTo((100 * positive[dim]) / total, 1);
      }
    }
  });

  it('gives exactly 50 to a dimension with no contribution', () => {
    const scores = scoreDimensions(allFirst);
    const neutral = DIMENSION_ORDER.filter((d) => {
      const { positive, negative } = accumulateWeights(allFirst);
      return positive[d] + negative[d] === 0;
    });
    for (const d of neutral) expect(scores[d]).toBe(50);
  });

  it('reacts to a single changed answer', () => {
    const before = scoreDimensions(allFirst);
    const changed = allFirst.map((a) =>
      a.questionId === 'q04' ? { ...a, optionId: 'd' } : a,
    );
    const after = scoreDimensions(changed);
    const diff = DIMENSION_ORDER.filter((d) => before[d] !== after[d]);
    expect(diff).toContain('stability');
    expect(diff).toContain('mission');
    // q04 option A is stability+2, option D is stability-1 with mission+2.
    expect(after.stability).toBeLessThan(before.stability);
    expect(after.mission).toBeGreaterThan(before.mission);
  });
});

describe('archetype selection', () => {
  it('always returns a primary and a distinct secondary', () => {
    const scores = scoreDimensions(allFirst);
    const { primary, secondary } = pickArchetypes(scores);
    expect(ARCHETYPE_ORDER).toContain(primary);
    expect(ARCHETYPE_ORDER).toContain(secondary);
    expect(primary).not.toBe(secondary);
  });

  it('breaks exact ties deterministically by declaration order', () => {
    const flat = Object.fromEntries(DIMENSION_ORDER.map((d) => [d, 50])) as Record<
      (typeof DIMENSION_ORDER)[number],
      number
    >;
    const affinities = archetypeAffinities(flat);
    expect(new Set(Object.values(affinities))).toEqual(new Set([0]));
    const first = pickArchetypes(flat);
    const second = pickArchetypes(flat);
    expect(first.primary).toBe(second.primary);
    expect(first.primary).toBe(ARCHETYPE_ORDER[0]);
  });

  it('picks 灯塔架构师 for an analysis-heavy profile', () => {
    const scores = {
      analysis: 95,
      stability: 72,
      autonomy: 70,
      imagination: 10,
      resilience: 55,
      mission: 60,
      expression: 30,
      intimacy: 35,
    } as const;
    expect(pickArchetypes(scores).primary).toBe('lighthouse');
  });

  it('picks 山野拓荒者 for a risk-taking, mission-driven profile', () => {
    const scores = {
      analysis: 20,
      stability: 8,
      autonomy: 80,
      imagination: 70,
      resilience: 65,
      mission: 92,
      expression: 60,
      intimacy: 25,
    } as const;
    expect(pickArchetypes(scores).primary).toBe('pioneer');
  });

  it('picks 静水深流者 for an introverted, space-loving profile', () => {
    const scores = {
      analysis: 65,
      stability: 55,
      autonomy: 95,
      imagination: 58,
      resilience: 50,
      mission: 60,
      expression: 8,
      intimacy: 10,
    } as const;
    expect(pickArchetypes(scores).primary).toBe('current');
  });
});

describe('strongest / weakest', () => {
  it('finds the extremes and ties resolve by declaration order', () => {
    const scores = {
      analysis: 80,
      stability: 80,
      autonomy: 40,
      imagination: 40,
      resilience: 50,
      mission: 50,
      expression: 50,
      intimacy: 50,
    } as const;
    expect(strongestDimension(scores)).toBe('analysis');
    expect(weakestDimension(scores)).toBe('autonomy');

    const allEqual = Object.fromEntries(DIMENSION_ORDER.map((d) => [d, 50])) as Record<
      (typeof DIMENSION_ORDER)[number],
      number
    >;
    expect(strongestDimension(allEqual)).toBe(DIMENSION_ORDER[0]);
    expect(weakestDimension(allEqual)).toBe(DIMENSION_ORDER[0]);
  });
});

describe('buildReport', () => {
  it('is fully deterministic for identical answers', () => {
    expect(JSON.stringify(buildReport(allSecond))).toBe(JSON.stringify(buildReport(allSecond)));
  });

  it('produces a complete, renderable report', () => {
    const report = buildReport(allFirst);
    expect(report.scoringVersion).toBe('v1');
    expect(ARCHETYPE_ORDER).toContain(report.archetypeId);
    expect(report.coreTraits.length).toBeGreaterThanOrEqual(4);
    expect(report.strengths.length).toBeGreaterThanOrEqual(3);
    expect(report.blindSpots.length).toBeGreaterThanOrEqual(3);
    expect(report.growth).toHaveLength(3);
    expect(report.career.directions.length).toBeGreaterThanOrEqual(3);
    expect(report.workEnvironment.suited.length).toBeGreaterThanOrEqual(3);
    expect(report.workEnvironment.stressful.length).toBeGreaterThanOrEqual(3);
    expect(report.communication.tips.length).toBeGreaterThanOrEqual(2);
    expect(report.relationship.needs.length).toBeGreaterThanOrEqual(3);
    expect(report.relationship.strengths.length).toBeGreaterThanOrEqual(2);
    expect(report.relationship.frictions.length).toBeGreaterThanOrEqual(3);
    expect(report.relationship.partnerTips.length).toBeGreaterThanOrEqual(3);
    expect(report.dimensionNotes).toHaveLength(8);
    expect(report.keywords).toHaveLength(3);
  });

  it('varies with the answers instead of returning one template', () => {
    const a = JSON.stringify(buildReport(allFirst));
    const b = JSON.stringify(buildReport(allSecond));
    const c = JSON.stringify(buildReport(allThird));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('embeds the real scores into strengths, blind spots and growth advice', () => {
    const report = buildReport(allThird);
    const weakestScore = report.scores[report.weakest];
    expect(report.blindSpots[0]).toContain(String(weakestScore));
    expect(report.growth[1]).toContain(String(weakestScore));
  });

  it('flags a balanced profile', () => {
    const report = buildReport(allFirst);
    expect(typeof report.balanced).toBe('boolean');
    expect(report.spread).toBeGreaterThanOrEqual(0);
  });

  it('throws on illegal input before producing anything', () => {
    expect(() => buildReport(allFirst.slice(0, 10))).toThrow(ScoringError);
  });

  it('changes the report when a single answer is edited', () => {
    const before = buildReport(allSecond);
    const after = buildReport(
      allSecond.map((a) => (a.questionId === 'q22' ? { ...a, optionId: 'a' } : a)),
    );
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
  });

  it('never leaks the raw answers into the report', () => {
    const serialised = JSON.stringify(buildReport(allFourth));
    expect(serialised).not.toContain('q01');
    expect(serialised).not.toContain('optionId');
  });
});

describe('distribution sanity', () => {
  it('covers more than one archetype across uniform answer sets', () => {
    const ids = new Set([allFirst, allSecond, allThird, allFourth].map((s) => buildReport(s).archetypeId));
    expect(ids.size).toBeGreaterThan(1);
  });

  it('reaches several archetypes when answers are mixed', () => {
    // Deterministic PRNG so the test is reproducible without Math.random.
    const mulberry32 = (seed: number) => () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const ids = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const rand = mulberry32(seed);
      const set = QUESTIONS.map((q) => ({
        questionId: q.id,
        optionId: q.options[Math.floor(rand() * 4)].id,
      }));
      ids.add(buildReport(set).archetypeId);
    }
    expect(ids.size).toBeGreaterThanOrEqual(4);
  });
});