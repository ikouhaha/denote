export type RankingInput = {
  source: string;
  ids: string[];
};

export type ReciprocalRankFusionInput = {
  rankings: RankingInput[];
  k?: number;
  limit?: number;
};

export type FusedHit = {
  id: string;
  score: number;
  sources: string[];
};

type MutableFusedHit = FusedHit & {
  firstSeen: number;
};

export function reciprocalRankFusion(input: ReciprocalRankFusionInput): FusedHit[] {
  const k = input.k ?? 60;
  const hits = new Map<string, MutableFusedHit>();
  let firstSeenCounter = 0;

  for (const ranking of input.rankings) {
    ranking.ids.forEach((id, index) => {
      const existing = hits.get(id);
      const score = 1 / (k + index + 1);

      if (existing) {
        existing.score += score;
        if (!existing.sources.includes(ranking.source)) {
          existing.sources.push(ranking.source);
        }
        return;
      }

      hits.set(id, {
        id,
        score,
        sources: [ranking.source],
        firstSeen: firstSeenCounter
      });
      firstSeenCounter += 1;
    });
  }

  const sorted = [...hits.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return a.firstSeen - b.firstSeen;
  });

  return sorted.slice(0, input.limit).map(({ firstSeen: _firstSeen, ...hit }) => hit);
}
