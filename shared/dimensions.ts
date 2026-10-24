import type { Dimension, DimensionId } from './types.ts';

export const SCORING_VERSION = 'v1';

export const DIMENSION_ORDER: readonly DimensionId[] = [
  'analysis',
  'stability',
  'autonomy',
  'imagination',
  'resilience',
  'mission',
  'expression',
  'intimacy',
] as const;

export const DIMENSIONS: Record<DimensionId, Dimension> = {
  analysis: {
    id: 'analysis',
    name: '分析直觉',
    question: '做决定时，你更相信推演出来的结果，还是当下的直觉？',
    high: { high: '分析型', mild: '偏分析' },
    low: { high: '直觉型', mild: '偏直觉' },
    balance: '双轨判断',
  },
  stability: {
    id: 'stability',
    name: '稳健冒险',
    question: '面对不确定，你更想守住已有的，还是去够更高的？',
    high: { high: '稳健型', mild: '偏稳健' },
    low: { high: '冒险型', mild: '偏冒险' },
    balance: '风险中性',
  },
  autonomy: {
    id: 'autonomy',
    name: '独立协作',
    question: '你更享受一个人把事做透，还是和一群人把它做成？',
    high: { high: '独立型', mild: '偏独立' },
    low: { high: '协作型', mild: '偏协作' },
    balance: '场景切换型',
  },
  imagination: {
    id: 'imagination',
    name: '想象落地',
    question: '想到一个好点子时，你更兴奋的是蓝图本身，还是把它做出来？',
    high: { high: '想象型', mild: '偏想象' },
    low: { high: '落地型', mild: '偏落地' },
    balance: '创意执行一体',
  },
  resilience: {
    id: 'resilience',
    name: '承压卸压',
    question: '压力来的时候，你的默认动作是顶上去，还是先给自己松绑？',
    high: { high: '承压型', mild: '偏承压' },
    low: { high: '卸压型', mild: '偏卸压' },
    balance: '压力弹性型',
  },
  mission: {
    id: 'mission',
    name: '意义回报',
    question: '如果只能选一个，你更想被什么定义：做成了什么，还是赚到了什么？',
    high: { high: '意义型', mild: '偏意义' },
    low: { high: '回报型', mild: '偏回报' },
    balance: '双引擎驱动',
  },
  expression: {
    id: 'expression',
    name: '外放内收',
    question: '在一屋子人里，你更常开口，还是更常观察？',
    high: { high: '外放型', mild: '偏外放' },
    low: { high: '内收型', mild: '偏内收' },
    balance: '选择性表达',
  },
  intimacy: {
    id: 'intimacy',
    name: '贴近留白',
    question: '在亲密关系里，你要的是紧紧靠近，还是各自留一片天？',
    high: { high: '贴近型', mild: '偏贴近' },
    low: { high: '留白型', mild: '偏留白' },
    balance: '有弹性的亲密',
  },
};

/** Human readable interpretation for a 0–100 axis score. */
export function describeScore(id: DimensionId, score: number): { label: string; note: string } {
  const dim = DIMENSIONS[id];
  if (score >= 75) return { label: dim.high.high, note: '这一面是你的默认设置' };
  if (score >= 65) return { label: dim.high.high, note: '明显偏向这一侧' };
  if (score >= 58) return { label: dim.high.mild, note: '轻度偏向这一侧' };
  if (score <= 25) return { label: dim.low.high, note: '这一面是你的默认设置' };
  if (score <= 35) return { label: dim.low.high, note: '明显偏向这一侧' };
  if (score <= 42) return { label: dim.low.mild, note: '轻度偏向这一侧' };
  return { label: dim.balance, note: '几乎不偏科，两头都能用' };
}