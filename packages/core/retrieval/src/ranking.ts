import { canonicalResourceKey } from "./identity.ts";
import type {
  RetrievalDocument,
  RetrievalHit,
  RetrievalSourceDescription,
} from "./types.ts";

const K1 = 1.2;
const B = 0.75;

export function tokenizeRetrievalText(text: string): readonly string[] {
  return (text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_-]+/gu) ?? []).filter(
    (term) => term.length > 0
  );
}

export function rankAuthorizedDocuments(
  description: RetrievalSourceDescription,
  generationId: string,
  documents: readonly RetrievalDocument[],
  queryText: string
): readonly RetrievalHit[] {
  const queryTerms = [...new Set(tokenizeRetrievalText(queryText))].sort();
  if (queryTerms.length === 0 || documents.length === 0) return [];
  const rows = documents.map((document) => {
    const terms = tokenizeRetrievalText(document.searchText);
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    return { document, terms, frequencies };
  });
  const averageLength =
    rows.reduce((sum, row) => sum + row.terms.length, 0) / rows.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(
      term,
      rows.reduce((count, row) => count + (row.frequencies.has(term) ? 1 : 0), 0)
    );
  }

  return rows
    .map(({ document, terms, frequencies }): RetrievalHit | null => {
      const matchedTerms = queryTerms.filter((term) => frequencies.has(term));
      if (matchedTerms.length === 0) return null;
      let lexical = 0;
      for (const term of matchedTerms) {
        const frequency = frequencies.get(term) ?? 0;
        const containing = documentFrequency.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 + (rows.length - containing + 0.5) / (containing + 0.5)
        );
        const denominator =
          frequency + K1 * (1 - B + B * (terms.length / averageLength));
        lexical += inverseDocumentFrequency * ((frequency * (K1 + 1)) / denominator);
      }
      const final = lexical + description.priority;
      return {
        resource: document.resource,
        audience: document.audience,
        generationId,
        scores: {
          lexical: {
            algorithm: "bm25",
            sourceId: description.id,
            value: lexical,
          },
          sourcePriority: description.priority,
          final,
        },
        matchedTerms,
      };
    })
    .filter((hit): hit is RetrievalHit => hit !== null)
    .sort(compareRetrievalHits);
}

export function compareRetrievalHits(left: RetrievalHit, right: RetrievalHit): number {
  return (
    right.scores.final - left.scores.final ||
    right.scores.lexical.value - left.scores.lexical.value ||
    compareOpaque(left.resource.sourceId, right.resource.sourceId) ||
    compareOpaque(canonicalResourceKey(left.resource), canonicalResourceKey(right.resource))
  );
}

function compareOpaque(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
