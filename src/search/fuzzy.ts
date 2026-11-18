// fzf-style matching: the query's letters must appear in the text in order, not necessarily
// together. No typo tolerance. Spaces split the query into terms that must all match, in any order.
// A term with an uppercase letter matches case-sensitively; otherwise case is ignored.

export interface Match {
  /** Higher is better. Only meaningful for comparing matches of the same query. */
  score: number;
  /** Indexes of the matched characters in the text, ascending. */
  positions: number[];
}

const CHAR = 16;
const CONSECUTIVE = 8;
const WORD_START = 10;
const MAX_GAP_PENALTY = 8;

const isAlnum = (c: string) => /[\p{L}\p{N}]/u.test(c);
const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase();
const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();

/** Start of a word: text start, after a separator, or a camelCase hump. */
function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1]!;
  const cur = text[i]!;
  return !isAlnum(prev) ? isAlnum(cur) : isLower(prev) && isUpper(cur);
}

function matchTerm(term: string, text: string): Match | null {
  const haystack = /\p{Lu}/u.test(term) ? text : text.toLowerCase();

  // Forward: where the earliest complete match ends.
  let qi = 0;
  let end = -1;
  for (let i = 0; i < haystack.length; i++) {
    if (haystack[i] === term[qi] && ++qi === term.length) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  // Backward from there: the latest start, which gives the tightest window.
  let start = end;
  for (let i = end, q = term.length - 1; i >= 0; i--) {
    if (haystack[i] === term[q] && --q < 0) {
      start = i;
      break;
    }
  }

  const positions: number[] = [];
  for (let i = start, q = 0; q < term.length; i++) {
    if (haystack[i] === term[q]) {
      positions.push(i);
      q++;
    }
  }

  let score = 0;
  let prev = -1;
  for (const p of positions) {
    score += CHAR;
    if (prev !== -1 && p === prev + 1) score += CONSECUTIVE;
    else if (prev !== -1) score -= Math.min(p - prev - 1, MAX_GAP_PENALTY);
    if (isWordStart(text, p)) score += WORD_START;
    prev = p;
  }
  // Earlier matches win ties: "git" ranks "GitHub" above "Digital".
  score -= Math.min(start, 20) / 4;
  return { score, positions };
}

export function fuzzyMatch(query: string, text: string): Match | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { score: 0, positions: [] };
  let score = 0;
  const positions = new Set<number>();
  for (const term of terms) {
    const match = matchTerm(term, text);
    if (!match) return null;
    score += match.score;
    for (const p of match.positions) positions.add(p);
  }
  return { score, positions: [...positions].sort((a, b) => a - b) };
}
