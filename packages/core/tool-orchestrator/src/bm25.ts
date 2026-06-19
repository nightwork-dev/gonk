import type { ToolDefinition } from "@gonk/tool-registry";
import type { RankedTool } from "./types.ts";

const K1 = 1.2;
const B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
}

interface FieldTokens {
  name: string[];
  cat: string[];
  body: string[];
}

function fieldTokens(tool: ToolDefinition): FieldTokens {
  return {
    name: tokenize(tool.name),
    cat: tokenize(tool.category ?? ""),
    body: tokenize(
      [tool.description, ...(tool.tags ?? []), ...(tool.keywords ?? [])].join(" "),
    ),
  };
}

const FIELD_WEIGHTS: Record<keyof FieldTokens, number> = {
  name: 3.0,
  cat: 2.0,
  body: 1.0,
};

export function bm25Search(query: string, tools: ToolDefinition[]): RankedTool[] {
  const qTerms = tokenize(query);
  if (qTerms.length === 0 || tools.length === 0) return [];

  const docs = tools.map(fieldTokens);

  // Average field lengths.
  const avgLen: Record<keyof FieldTokens, number> = { name: 0, cat: 0, body: 0 };
  for (const d of docs) {
    avgLen.name += d.name.length;
    avgLen.cat += d.cat.length;
    avgLen.body += d.body.length;
  }
  avgLen.name /= docs.length;
  avgLen.cat /= docs.length;
  avgLen.body /= docs.length;

  // IDF per term per field (corpus = tools).
  const idf = (field: keyof FieldTokens, term: string): number => {
    let df = 0;
    for (const d of docs) {
      if (d[field].includes(term)) df++;
    }
    if (df === 0) return 0;
    return Math.log((docs.length - df + 0.5) / (df + 0.5) + 1);
  };

  const fieldScore = (
    tokens: string[],
    term: string,
    avgFieldLen: number,
  ): number => {
    const tf = tokens.filter((t) => t === term).length;
    if (tf === 0) return 0;
    const norm = tf * (K1 + 1);
    const denom = tf + K1 * (1 - B + B * (tokens.length / (avgFieldLen || 1)));
    return norm / denom;
  };

  const scored: RankedTool[] = [];

  for (let i = 0; i < tools.length; i++) {
    const doc = docs[i]!;
    const t = tools[i]!;
    let total = 0;
    const fieldContribs: Record<keyof FieldTokens, number> = { name: 0, cat: 0, body: 0 };

    for (const term of qTerms) {
      for (const f of ["name", "cat", "body"] as const) {
        const w = FIELD_WEIGHTS[f];
        const termIdf = idf(f, term);
        const fs = fieldScore(doc[f], term, avgLen[f]);
        const contrib = w * termIdf * fs;
        fieldContribs[f] += contrib;
        total += contrib;
      }
    }

    if (total <= 0) continue;

    // Dominant field for reason label.
    let reason = "bm25";
    const max = Math.max(fieldContribs.name, fieldContribs.cat, fieldContribs.body);
    const threshold = total * 0.5;
    if (fieldContribs.name >= threshold && fieldContribs.name === max) {
      reason = "bm25:name";
    } else if (fieldContribs.cat >= threshold && fieldContribs.cat === max) {
      reason = "bm25:cat";
    } else if (fieldContribs.body >= threshold && fieldContribs.body === max) {
      reason = "bm25:body";
    }

    scored.push({ tool: t, score: total, reason });
  }

  scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return scored;
}
