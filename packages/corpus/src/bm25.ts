/**
 * Okapi BM25（HY-01）：语料规模较小时内存索引即可，无需 ES。
 */
export type Bm25Index = {
    score: (queryTokens: string[]) => number[];
};

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

/** 构建 BM25 索引；docs 为已分词的文档 token 列表。 */
export const buildBm25Index = (
    docs: string[][],
    k1 = DEFAULT_K1,
    b = DEFAULT_B
): Bm25Index => {
    const n = docs.length;
    if (n === 0) {
        return { score: () => [] };
    }

    const docLengths = docs.map((d) => d.length);
    const avgdl = docLengths.reduce((a, x) => a + x, 0) / n;

    const df = new Map<string, number>();
    for (const doc of docs) {
        const seen = new Set<string>();
        for (const term of doc) {
            if (seen.has(term)) continue;
            seen.add(term);
            df.set(term, (df.get(term) ?? 0) + 1);
        }
    }

    const termFreqs = docs.map((doc) => {
        const tf = new Map<string, number>();
        for (const term of doc) {
            tf.set(term, (tf.get(term) ?? 0) + 1);
        }
        return tf;
    });

    const idf = (term: string): number => {
        const nQi = df.get(term) ?? 0;
        if (nQi === 0) return 0;
        return Math.log(1 + (n - nQi + 0.5) / (nQi + 0.5));
    };

    return {
        score(queryTokens: string[]): number[] {
            const uniqueQuery = [...new Set(queryTokens)];
            return docs.map((_, i) => {
                const dl = docLengths[i]!;
                const tf = termFreqs[i]!;
                let sum = 0;
                for (const term of uniqueQuery) {
                    const freq = tf.get(term) ?? 0;
                    if (freq === 0) continue;
                    const idfVal = idf(term);
                    const num = freq * (k1 + 1);
                    const den = freq + k1 * (1 - b + (b * dl) / avgdl);
                    sum += idfVal * (num / den);
                }
                return sum;
            });
        },
    };
};
