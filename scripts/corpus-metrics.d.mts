export interface CorpusCounts {
  total: number;
  effortExact: number;
  effortNear: number;
  tierExact: number;
}

export const CORPUS_THRESHOLDS: {
  readonly effortExact: number;
  readonly effortNear: number;
  readonly tierExact: number;
};

export function corpusPass(counts: CorpusCounts): boolean;
export function formatPct(numerator: number, denominator: number): string;
