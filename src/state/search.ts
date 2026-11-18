import { fuzzyMatch } from "../search/fuzzy";
import { stackKey, type Row } from "./rows";

// Search in the tabs view: matches tabs by title or URL and stacks by name. Results keep the list's
// order and grouping, so they read like the full list with rows left out:
//
// - a workspace row shows when anything below it matches (not focusable, so only for context),
// - a stack row shows when its name matches or one of its tabs does,
// - a tab inside a stack shows only when it matches itself.

export interface RowMatch {
  field: "title" | "url" | "name";
  positions: number[];
  score: number;
}

export interface SearchResult {
  rows: Row[];
  /** Why each matching row matched. Rows shown only for context have no entry. */
  matches: ReadonlyMap<string, RowMatch>;
  /** The best-scoring row, for focus. */
  best: string | null;
}

function matchRow(row: Row, query: string): RowMatch | null {
  if (row.kind === "stack") {
    const m = fuzzyMatch(query, row.stack.name);
    return m && { field: "name", ...m };
  }
  if (row.kind === "tab") {
    const title = fuzzyMatch(query, row.tab.title);
    const url = fuzzyMatch(query, row.tab.url);
    // The title is what's shown, so it wins a tie.
    if (title && (!url || title.score >= url.score)) return { field: "title", ...title };
    return url && { field: "url", ...url };
  }
  return null;
}

export function searchRows(rows: Row[], query: string): SearchResult {
  if (query.trim() === "") return { rows, matches: new Map(), best: null };

  const matches = new Map<string, RowMatch>();
  const shown = new Set<string>();
  let best: { key: string; score: number } | null = null;
  for (const row of rows) {
    const match = matchRow(row, query);
    if (!match) continue;
    matches.set(row.key, match);
    shown.add(row.key);
    if (row.kind === "tab" && row.stackId !== null) shown.add(stackKey(row.stackId));
    if (!best || match.score > best.score) best = { key: row.key, score: match.score };
  }

  const result: Row[] = [];
  let workspace: Row | null = null;
  for (const row of rows) {
    if (row.kind === "workspace") {
      workspace = row;
    } else if (shown.has(row.key)) {
      if (workspace) result.push(workspace);
      workspace = null;
      result.push(row);
    }
  }
  return { rows: result, matches, best: best?.key ?? null };
}
