// AUTO-GENERATED FROM shared/ — do not edit here.
// Run `npm run sync:shared` after editing the files in shared/.
import { ARCHETYPE_ORDER, ARCHETYPES, getArchetype } from './archetypes.ts';
import { DIMENSIONS, DIMENSION_ORDER, SCORING_VERSION, describeScore } from './dimensions.ts';
import { QUESTIONS } from './questions.ts';
import type {
  Answer,
  ArchetypeId,
  DimensionId,
  DimensionScores,
  Report,
} from './types.ts';

/**
 * Deterministic, dependency-free scoring engine.
 *
 * Guarantees:
 *  - The same answers + the same SCORING_VERSION always produce identical output.
 *  - The client never supplies scores; it only supplies questionId/optionId pairs.
 *  - All rounding is done explicitly so results are stable across runtimes.
 */

const OPTION_LOOKUP: Map<string, Map<string, Record<string, number>>> = (() => {
  const map = new Map<string, Map<string, Record<string, number>>>();
  for (const q of QUESTIONS) {
    const inner = new Map<string, Record<string, number>>();
    for (const opt of q.options) inner.set(opt.id, opt.weights);
    map.set(q.id, inner);
  }
  return map;
})();

export class ScoringError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ScoringError';
    this.code = code;
  }
}

export function getQuestion(questionId: string) {
  return QUESTIONS.find((q) => q.id === questionId);
}

export function isValidOption(questionId: string, optionId: string): boolean {
  return OPTION_LOOKUP.get(questionId)?.has(optionId) ?? false;
}

/** Validate a full answer set. Throws ScoringError with a stable code. */
export function validateAnswers(answers: readonly Answer[]): void {
  if (!Array.isArray(answers)) {
    throw new ScoringError('invalid_answers', 'answers must be an array');
  }
  const seen = new Set<string>();
  for (const a of answers) {
    if (!a || typeof a.questionId !== 'string' || typeof a.optionId !== 'string') {
      throw new ScoringError('invalid_answer_shape', 'each answer needs questionId and optionId');
    }
    const options = OPTION_LOOKUP.get(a.questionId);
    if (!options) {
      throw new ScoringError('unknown_question', `unknown question: ${a.questionId}`);
    }
    if (!options.has(a.optionId)) {
      throw new ScoringError('invalid_option', `invalid option ${a.optionId} for ${a.questionId}`);
    }
    if (seen.has(a.questionId)) {
      throw new ScoringError('duplicate_answer', `duplicate answer for ${a.questionId}`);
    }
    seen.add(a.questionId);
  }
  if (answers.length !== QUESTIONS.length) {
    throw new ScoringError(
      'incomplete_answers',
      `expected ${QUESTIONS.length} answers, received ${answers.length}`,
    );
  }
  for (const q of QUESTIONS) {
    if (!seen.has(q.id)) {
      throw new ScoringError('incomplete_answers', `missing answer for ${q.id}`);
    }
  }
}

/** Map answers to per-dimension positive / negative pressure. */
export function accumulateWeights(answers: readonly Answer[]): {
  positive: Record<string, number>;
  negative: Record<string, number>;
} {
  const positive: Record<string, number> = {};
  const negative: Record<string, number> = {};
  for (const id of DIMENSION_ORDER) {
    positive[id] = 0;
    negative[id] = 0;
  }
  for (const a of answers) {
    const weights = OPTION_LOOKUP.get(a.questionId)?.get(a.optionId) ?? {};
    for (const [dim, raw] of Object.entries(weights)) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value === 0) continue;
      if (!(dim in positive)) continue; // unknown dimension keys are ignored defensively
      if (value > 0) positive[dim] += value;
      else negative[dim] += -value;
    }
  }
  return { positive, negative };
}

/**
 * score = 100 * pos / (pos + neg)
 * When a dimension was never touched, the score defaults to the neutral 50.
 * The result is rounded to one decimal so it serialises identically everywhere.
 */
export function scoreDimensions(answers: readonly Answer[]): DimensionScores {
  const { positive, negative } = accumulateWeights(answers);
  const out = {} as DimensionScores;
  for (const id of DIMENSION_ORDER) {
    const p = positive[id] ?? 0;
    const n = negative[id] ?? 0;
    const total = p + n;
    out[id] = total === 0 ? 50 : Math.round((1000 * p) / total) / 10;
  }
  return out;
}

/**
 * Affinity of each archetype to the given profile.
 * score 50 counts as "no pull", so the deviation is used instead of the raw score.
 */
export function archetypeAffinities(scores: DimensionScores): Record<ArchetypeId, number> {
  const out = {} as Record<ArchetypeId, number>;
  for (const id of ARCHETYPE_ORDER) {
    const affinity = ARCHETYPES[id].affinity;
    let numerator = 0;
    let denominator = 0;
    for (const dim of DIMENSION_ORDER) {
      const w = affinity[dim] ?? 0;
      numerator += (scores[dim] - 50) * w;
      denominator += Math.abs(w);
    }
    out[id] = denominator === 0 ? 0 : Math.round((1000 * numerator) / denominator) / 10;
  }
  return out;
}

/**
 * Pick the archetype with the highest affinity.
 * Ties resolve by ARCHETYPE_ORDER, which makes the result fully deterministic.
 */
export function pickArchetypes(scores: DimensionScores): {
  primary: ArchetypeId;
  secondary: ArchetypeId;
  affinities: Record<ArchetypeId, number>;
} {
  const affinities = archetypeAffinities(scores);
  const ranked = [...ARCHETYPE_ORDER].sort((a, b) => {
    if (affinities[b] !== affinities[a]) return affinities[b] - affinities[a];
    return ARCHETYPE_ORDER.indexOf(a) - ARCHETYPE_ORDER.indexOf(b);
  });
  return { primary: ranked[0], secondary: ranked[1], affinities };
}

/** Highest scoring axis; ties resolve by DIMENSION_ORDER. */
export function strongestDimension(scores: DimensionScores): DimensionId {
  return [...DIMENSION_ORDER].sort((a, b) => {
    if (scores[b] !== scores[a]) return scores[b] - scores[a];
    return DIMENSION_ORDER.indexOf(a) - DIMENSION_ORDER.indexOf(b);
  })[0];
}

/** Lowest scoring axis; ties resolve by DIMENSION_ORDER. */
export function weakestDimension(scores: DimensionScores): DimensionId {
  return [...DIMENSION_ORDER].sort((a, b) => {
    if (scores[a] !== scores[b]) return scores[a] - scores[b];
    return DIMENSION_ORDER.indexOf(a) - DIMENSION_ORDER.indexOf(b);
  })[0];
}

const DYNAMIC_NOTES: Record<DimensionId, [string, string, string, string, string]> = {
  analysis: [
    '你习惯先算清再落脚，代价是要比别人多花一点时间。',
    '你会先做个粗略判断，再回头验证，效率不错。',
    '分析到你不是目的而是一种习惯，这让你少踩很多坑。',
    '你也会靠直觉定方向，只是定完还会回头核对。',
    '你更相信当下的第一反应，这让你反应快，但也容易先斩后奏。',
  ],
  stability: [
    '你对不确定的容忍度很高，敢下注，但别忘了给自己留退路。',
    '你愿意冒险，不过前提是你看得见大致的结果。',
    '风险偏好中性，你在安全感和机会之间大致各取一半。',
    '你偏稳妥，愿意用时间换确定性。',
    '你把稳定放在很高的位置，也因此很难被突发状况打乱。',
  ],
  autonomy: [
    '你更需要独处才能出活，长时间社交对你是一种消耗。',
    '你倾向于一个人先做完，需要时才找人。',
    '你能独处也能并肩，是很好用的切换能力。',
    '你在团队里更自在，协作会明显放大你的产出。',
    '协作和共事带来的能量对你来说远大于独处。',
  ],
  imagination: [
    '你的想象力非常具体，能在脑子里把成品跑一遍。',
    '你有很好的概念能力，同时也不排斥动手。',
    '想象和落地你都能做，这在创作型工作里很稀缺。',
    '你更享受把东西真的做出来，方案要能落地才算数。',
    '你是执行导向的，先有结果再谈理想状态。',
  ],
  resilience: [
    '你的压力信号来得很晚，别人看不出你已经超载了。',
    '你抗压能力不错，但会适时停下来，不硬撑。',
    '你能扛也能卸，弹性比较好。',
    '你比较在意恢复和休息，不喜欢把自己耗干。',
    '你需要保护好情绪和能量，硬撑对你来说是净损耗。',
  ],
  mission: [
    '回报对你很重要，这没什么不好，只是别只剩下回报。',
    '你更看重现实结果，这在短期很有效。',
    '意义和回报你都想要，你会想办法两条都要。',
    '你更想被"做成了什么"定义。',
    '意义感是你选择标准里的第一顺位，别的都要排后面。',
  ],
  expression: [
    '你更常观察而非开口，很多想法只在小圈子里出现。',
    '你在熟人和重要场合才比较放得开。',
    '你能说也能听，表达方式会随场合调整。',
    '你比较能表达，沟通是你的优势而不是负担。',
    '你几乎不介意当众开口，这是很难得的社交能量。',
  ],
  intimacy: [
    '你在关系里需要不少自己的空间，独处比陪伴更能充电。',
    '你不太需要高频的亲密确认，关系里留着空白才舒服。',
    '你能亲近也能放手，弹性比较大。',
    '你重视情感连接，回应和确认对你很重要。',
    '你很需要亲近和连接，这段关系对你来说是生活的重心。',
  ],
};

function dimensionNote(id: DimensionId, score: number): string {
  const bucket =
    score >= 78 ? 4 : score >= 64 ? 3 : score >= 56 ? 2 : score >= 44 ? 2 : score >= 36 ? 1 : score >= 22 ? 1 : 0;
  return DYNAMIC_NOTES[id][bucket];
}

/** Merge archetype content with score-driven content into the final report. */
export function buildReport(answers: readonly Answer[], scoringVersion = SCORING_VERSION): Report {
  validateAnswers(answers);
  const scores = scoreDimensions(answers);
  const { primary, secondary } = pickArchetypes(scores);
  const arch = getArchetype(primary);
  const secondaryArch = getArchetype(secondary);

  const ranked = [...DIMENSION_ORDER].sort((a, b) => {
    if (scores[b] !== scores[a]) return scores[b] - scores[a];
    return DIMENSION_ORDER.indexOf(a) - DIMENSION_ORDER.indexOf(b);
  });
  const topDims = ranked.slice(0, 2);
  const bottomDims = ranked.slice(-2).reverse();

  const spread = Math.round((scores[ranked[0]] - scores[ranked[ranked.length - 1]]) * 10) / 10;
  const balanced = spread <= 18;
  const strongest = strongestDimension(scores);
  const weakest = weakestDimension(scores);

  // Traits: archetype core + the two highest scoring axes, described dynamically.
  const coreTraits = [
    ...arch.coreTraits,
    ...topDims.map((d) => {
      const { label } = describeScore(d, scores[d]);
      return `在「${DIMENSIONS[d].name}」这一轴上，你是${label}（${scores[d]} 分）。`;
    }),
  ];

  const strengths = [
    arch.strengths[0],
    `「${DIMENSIONS[strongest].name}」拿到 ${scores[strongest]} 分，这是你可以直接拿来用的优势。`,
    arch.strengths[1],
    arch.strengths[2],
    `「${DIMENSIONS[topDims[1]].name}」也有 ${scores[topDims[1]]} 分，和上一项叠加时你的表现会明显更好。`,
  ];

  const blindSpots = [
    `「${DIMENSIONS[weakest].name}」只有 ${scores[weakest]} 分，这是你最需要留意的短板。`,
    ...bottomDims
      .filter((d) => d !== weakest)
      .map((d) => `「${DIMENSIONS[d].name}」偏低（${scores[d]} 分），需要它的场合你会比较吃力。`),
    ...arch.blindSpots.slice(0, 2),
  ];

  const growth = [
    arch.growth[0],
    `针对「${DIMENSIONS[weakest].name}」偏低（${scores[weakest]} 分）：${growthAdviceFor(weakest, scores[weakest])}`,
    arch.growth[1],
  ];

  const keywords = [describeScore(strongest, scores[strongest]).label, arch.name, secondaryArch.name];

  const headline = balanced
    ? `${arch.name}｜一款少见的均衡配置`
    : `${arch.name}｜${describeScore(strongest, scores[strongest]).label}是你的底色`;

  return {
    scoringVersion,
    archetypeId: primary,
    archetypeName: arch.name,
    archetypeGlyph: arch.glyph,
    palette: arch.palette,
    tagline: arch.tagline,
    oneLiner: arch.oneLiner,
    secondaryArchetypeId: secondary,
    secondaryArchetypeName: secondaryArch.name,
    scores,
    strongest,
    weakest,
    spread,
    balanced,
    coreTraits,
    strengths,
    blindSpots,
    career: {
      directions: [
        ...arch.career.directions,
        {
          title: `${DIMENSIONS[strongest].name}优势延伸方向`,
          reason: `${dimensionNote(strongest, scores[strongest])}把这条轴当主线，你的路会顺很多。`,
        },
      ],
    },
    workEnvironment: arch.workEnvironment,
    communication: {
      style: `${arch.communication.style}（外放内收轴 ${scores.expression} 分）`,
      tips: [...arch.communication.tips, ...(scores.expression <= 35 ? ['把想说的话先写成文字，再决定要不要发出去。'] : [])],
    },
    relationship: {
      needs: arch.relationship.needs,
      strengths: arch.relationship.strengths,
      frictions: [...arch.relationship.frictions, ...dynamicFrictions(scores)],
      partnerTips: [
        ...arch.relationship.partnerTips,
        ...(scores.intimacy >= 58
          ? ['建立固定的连接仪式，比随机的问候更能安抚你。']
          : ['给彼此保留固定的独处时间，关系反而更稳。']),
      ],
    },
    growth,
    dimensionNotes: DIMENSION_ORDER.map((id) => ({
      id,
      name: DIMENSIONS[id].name,
      score: scores[id],
      note: dimensionNote(id, scores[id]),
    })),
    headline,
    keywords,
  };
}

function dynamicFrictions(scores: DimensionScores): string[] {
  const extra: string[] = [];
  if (scores.intimacy >= 65) extra.push('你对亲密的需求偏高，容易因为对方回应不及时而不安。');
  if (scores.intimacy <= 35) extra.push('你对空间的需求偏高，容易让对方觉得被推开。');
  if (scores.expression <= 35) extra.push('你不擅长把需求说出来，对方只能靠猜。');
  if (scores.expression >= 65) extra.push('你表达直接，遇到分歧时对方需要一点缓冲时间。');
  if (scores.mission >= 70) extra.push('你很容易把工作和生活绑在一起，缺少真正的断点。');
  if (scores.stability <= 30) extra.push('你不太愿意承认自己需要确定性，久了会一次性爆掉。');
  return extra;
}

function growthAdviceFor(dim: DimensionId, score: number): string {
  const base: Record<DimensionId, string> = {
    analysis: '下次做决定时，强制自己写下三个反对理由，训练"用直觉但不靠直觉"',
    stability: '主动制造一次可控的小风险，比如报名一个和现在完全不同的活动',
    autonomy: '练习在一件小事上完全独立完成，不找人商量、不求背书',
    imagination: '把你"总觉得能更好"的那个点子，限定两天做出可看的第一版',
    resilience: '建立一条"该停下来"的规则，比如连续加班三天后必须休整半天',
    mission: '写下三件你愿意长期投入但没有回报的事，挑一件真的开始做',
    expression: '每天强制自己提一次不同意见，哪怕只是很小的一点',
    intimacy: '练习说一次"我需要你"，把说不出口的需求变成具体的句子',
  };
  const tone = score <= 25 ? '你的默认设置在这一侧偏弱，需要刻意练。' : '你在这一侧略有欠缺，可以小步补。';
  return `${tone}${base[dim]}。`;
}

/** Convenience wrapper used by both client previews and the server. */
export function scoreAndReport(answers: readonly Answer[], scoringVersion = SCORING_VERSION): Report {
  return buildReport(answers, scoringVersion);
}

export { SCORING_VERSION, DIMENSIONS, DIMENSION_ORDER, QUESTIONS };