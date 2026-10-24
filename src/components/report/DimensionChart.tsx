import { DIMENSIONS, DIMENSION_ORDER, describeScore } from '@shared/dimensions.ts';
import type { DimensionScores } from '@shared/types.ts';

/** Horizontal 0–100 bars with a neutral midpoint marker. */
export function DimensionChart({ scores }: { scores: DimensionScores }) {
  return (
    <ul className="space-y-3.5">
      {DIMENSION_ORDER.map((id) => {
        const score = scores[id];
        const { label } = describeScore(id, score);
        const highPct = Math.max(score, 50);
        const lowPct = Math.min(score, 50);
        return (
          <li key={id}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] font-medium text-ink">{DIMENSIONS[id].name}</span>
              <span className="shrink-0 text-[12px] text-brown-muted">
                {label}
                <span className="ml-1.5 font-mono text-orange">{score}</span>
              </span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-cream-deep">
              <div className="absolute inset-y-0 left-1/2 w-px bg-brown/15" aria-hidden />
              <div
                className="absolute inset-y-0 left-1/2 rounded-full bg-gradient-to-r from-orange-soft to-orange transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${(highPct - 50) / 2}%` }}
                aria-hidden
              />
              <div
                className="absolute inset-y-0 right-1/2 rounded-full bg-gradient-to-r from-brown-muted to-brown-soft/70 transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${(50 - lowPct) / 2}%` }}
                aria-hidden
              />
            </div>
            <p className="sr-only">
              {DIMENSIONS[id].question} 当前 {score} 分，倾向{label}。
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact two-column version used inside the exported PNG. */
export function DimensionGrid({ scores }: { scores: DimensionScores }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      {DIMENSION_ORDER.map((id) => {
        const score = scores[id];
        const { label } = describeScore(id, score);
        const width = `${Math.max(4, score)}%`;
        return (
          <div key={id}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-[#3A2E26]">{DIMENSIONS[id].name}</span>
              <span className="text-[12px] text-[#9A8878]">
                {label}
                <span className="ml-1 font-mono text-[#D2762F]">{score}</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#F0E5D4]">
              <div
                className="h-full rounded-full"
                style={{ width, background: 'linear-gradient(90deg,#F0C79B,#D2762F)' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}