/**
 * HY-03：Reciprocal Rank Fusion（RRF）。
 * score(d) = Σ weight / (k + rank(d))
 */
export type RrfRankedItem = {
    path: string;
    fusionScore: number;
};

export const fuseRrf = (
    lists: { paths: string[]; weight?: number }[],
    k = 60
): RrfRankedItem[] => {
    const scores = new Map<string, number>();
    for (const list of lists) {
        const weight = list.weight ?? 1;
        list.paths.forEach((path, rank) => {
            scores.set(path, (scores.get(path) ?? 0) + weight / (k + rank + 1));
        });
    }
    return [...scores.entries()]
        .map(([path, fusionScore]) => ({ path, fusionScore }))
        .sort((a, b) => b.fusionScore - a.fusionScore);
};
