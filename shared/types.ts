/**
 * Shared domain types.
 * This module is the single source of truth and is consumed by BOTH the
 * Vite front-end and the Supabase Edge Functions (Deno). Keep it dependency free.
 */

export type DimensionId =
  | 'analysis'
  | 'stability'
  | 'autonomy'
  | 'imagination'
  | 'resilience'
  | 'mission'
  | 'expression'
  | 'intimacy';

export type PoleLabel = {
  /** Label used when the score is clearly on this side (>= 65). */
  high: string;
  /** Label used when the score is moderately on this side (>= 55). */
  mild: string;
};

export type Dimension = {
  id: DimensionId;
  /** Short name used in the dimension chart, 2–4 Chinese characters. */
  name: string;
  /** One sentence describing what this axis measures. */
  question: string;
  /** The high side of the axis. */
  high: PoleLabel;
  /** The low side of the axis. */
  low: PoleLabel;
  /** Divider label shown in the middle of the chart. */
  balance: string;
};

export type OptionWeights = Partial<Record<DimensionId, number>>;

export type QuestionOption = {
  id: string;
  label: string;
  /** Positive pushes toward the dimension's `high` pole, negative toward `low`. */
  weights: OptionWeights;
};

export type Question = {
  id: string;
  /** Section label so the UI can group questions without adding more questions. */
  section: string;
  text: string;
  options: [QuestionOption, QuestionOption, QuestionOption, QuestionOption];
};

export type Answer = {
  questionId: string;
  optionId: string;
};

export type DimensionScores = Record<DimensionId, number>;

export type ArchetypeId =
  | 'lighthouse'
  | 'pioneer'
  | 'translator'
  | 'forge'
  | 'dreamweaver'
  | 'helmsman'
  | 'wave'
  | 'current';

export type Archetype = {
  id: ArchetypeId;
  name: string;
  /** Two characters shown as the emblem. */
  glyph: string;
  tagline: string;
  oneLiner: string;
  coreTraits: string[];
  strengths: string[];
  blindSpots: string[];
  career: { directions: { title: string; reason: string }[] };
  workEnvironment: { suited: string[]; stressful: string[] };
  communication: { style: string; tips: string[] };
  relationship: {
    needs: string[];
    strengths: string[];
    frictions: string[];
    partnerTips: string[];
  };
  growth: string[];
  /** Affinity weight per dimension (0–2). Drives archetype selection. */
  affinity: Record<DimensionId, number>;
  /** Accent colour tokens (hex) used by the export card and result page. */
  palette: { ink: string; accent: string; soft: string };
};

/** Everything the front-end needs to render a report. */
export type Report = {
  scoringVersion: string;
  archetypeId: ArchetypeId;
  archetypeName: string;
  archetypeGlyph: string;
  palette: { ink: string; accent: string; soft: string };
  tagline: string;
  oneLiner: string;
  secondaryArchetypeId: ArchetypeId;
  secondaryArchetypeName: string;
  scores: DimensionScores;
  /** Highest scoring axis. */
  strongest: DimensionId;
  /** Lowest scoring axis. */
  weakest: DimensionId;
  /** Score spread: highest - lowest. High spread means a clearly "shaped" profile. */
  spread: number;
  /** True when every axis sits close to the middle (a genuinely even profile). */
  balanced: boolean;
  coreTraits: string[];
  strengths: string[];
  blindSpots: string[];
  career: { directions: { title: string; reason: string }[] };
  workEnvironment: { suited: string[]; stressful: string[] };
  communication: { style: string; tips: string[] };
  relationship: {
    needs: string[];
    strengths: string[];
    frictions: string[];
    partnerTips: string[];
  };
  growth: string[];
  /** Dynamic, score-driven sentences. */
  dimensionNotes: { id: DimensionId; name: string; score: number; note: string }[];
  /** Short line rendered on the share card / PNG. */
  headline: string;
  keywords: string[];
};