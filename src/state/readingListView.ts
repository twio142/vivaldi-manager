import type { ReadingListEntry } from "../protocol/types";
import { fuzzyMatch } from "../search/fuzzy";

// The reading list view's keyboard state machine, pure like the tabs view's. Entries are keyed by
// URL, as in Vivaldi, so focus is a URL. The view shows `visibleEntries`: the list filtered by the
// hide-read toggle and the search query, in the chosen sort order.

export type SortOrder = "date" | "title" | "read";
export const SORT_ORDERS: readonly SortOrder[] = ["date", "title", "read"];
export const SORT_LABELS: Record<SortOrder, string> = { date: "Date", title: "Title", read: "Unread" };

/** Kept across popup openings. */
export interface ReadingListPrefs {
  sort: SortOrder;
  hideRead: boolean;
}

export const DEFAULT_PREFS: ReadingListPrefs = { sort: "date", hideRead: false };

export interface ReadingListViewState extends ReadingListPrefs {
  mode: "normal" | "search";
  focus: string | null;
  query: string;
}

export type ReadingListEffect =
  | { type: "open"; url: string }
  | { type: "remove"; url: string }
  | { type: "copy"; urls: string[] }
  | { type: "setRead"; url: string; read: boolean }
  | { type: "savePrefs"; prefs: ReadingListPrefs }
  | { type: "closePopup" };

export interface ReadingListKeyResult {
  state: ReadingListViewState;
  effects: ReadingListEffect[];
  handled: boolean;
}

export interface EntryMatch {
  field: "title" | "url";
  positions: number[];
}

export interface VisibleEntries {
  entries: ReadingListEntry[];
  matches: ReadonlyMap<string, EntryMatch>;
  /** The best search match, for focus. */
  best: string | null;
}

const byDate = (a: ReadingListEntry, b: ReadingListEntry) => b.lastUpdate - a.lastUpdate;
const COMPARE: Record<SortOrder, (a: ReadingListEntry, b: ReadingListEntry) => number> = {
  // Newest first, as Vivaldi's "Sort by Date Updated".
  date: byDate,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || byDate(a, b),
  read: (a, b) => Number(a.read) - Number(b.read) || byDate(a, b),
};

export function visibleEntries(all: ReadingListEntry[], view: ReadingListViewState): VisibleEntries {
  const shown = view.hideRead ? all.filter((e) => !e.read) : all;
  const sorted = [...shown].sort(COMPARE[view.sort]);
  if (view.query.trim() === "") return { entries: sorted, matches: new Map(), best: null };

  const matches = new Map<string, EntryMatch>();
  let best: { url: string; score: number } | null = null;
  for (const entry of sorted) {
    const title = fuzzyMatch(view.query, entry.title);
    const url = fuzzyMatch(view.query, entry.url);
    const match =
      title && (!url || title.score >= url.score) ? { field: "title" as const, ...title } : url && { field: "url" as const, ...url };
    if (!match) continue;
    matches.set(entry.url, { field: match.field, positions: match.positions });
    if (!best || match.score > best.score) best = { url: entry.url, score: match.score };
  }
  return { entries: sorted.filter((e) => matches.has(e.url)), matches, best: best?.url ?? null };
}

export function initialReadingListState(prefs: ReadingListPrefs = DEFAULT_PREFS): ReadingListViewState {
  return { ...prefs, mode: "normal", focus: null, query: "" };
}

/**
 * Keeps focus valid after the visible entries change (new entries, a sort, a filter); a removed
 * entry passes focus to the next one, and an unset focus goes to the top.
 */
export function reconcileReadingList(
  state: ReadingListViewState,
  oldEntries: ReadingListEntry[],
  newEntries: ReadingListEntry[],
): ReadingListViewState {
  const present = new Set(newEntries.map((e) => e.url));
  if (state.focus !== null && present.has(state.focus)) return state;
  const index = oldEntries.findIndex((e) => e.url === state.focus);
  const survivor =
    index === -1
      ? undefined
      : (oldEntries.slice(index + 1).find((e) => present.has(e.url)) ??
        oldEntries.slice(0, index).findLast((e) => present.has(e.url)));
  return { ...state, focus: survivor?.url ?? newEntries[0]?.url ?? null };
}

/** A new search query: focus jumps to its best match. */
export function setReadingListQuery(
  state: ReadingListViewState,
  all: ReadingListEntry[],
  query: string,
): ReadingListViewState {
  const next = { ...state, query };
  const { entries, best } = visibleEntries(all, next);
  return { ...next, focus: best ?? entries[0]?.url ?? state.focus };
}

function step(entries: ReadingListEntry[], focus: string | null, dir: 1 | -1): string | null {
  if (entries.length === 0) return null;
  const index = entries.findIndex((e) => e.url === focus);
  if (index === -1) return entries[dir === 1 ? 0 : entries.length - 1]!.url;
  return entries[(index + dir + entries.length) % entries.length]!.url;
}

const prefsOf = ({ sort, hideRead }: ReadingListViewState): ReadingListPrefs => ({ sort, hideRead });

/** `all` is the whole list; the keys act on what's visible. */
export function handleReadingListKey(
  state: ReadingListViewState,
  all: ReadingListEntry[],
  key: string,
): ReadingListKeyResult {
  const done = (next: ReadingListViewState, ...effects: ReadingListEffect[]) => ({
    state: next,
    effects,
    handled: true,
  });
  /** A change to what's shown: keep focus on a visible entry. */
  const reshown = (next: ReadingListViewState) =>
    reconcileReadingList(next, visibleEntries(all, state).entries, visibleEntries(all, next).entries);
  const { entries } = visibleEntries(all, state);
  const entry = entries.find((e) => e.url === state.focus);

  if (state.mode === "search") {
    switch (key) {
      case "ArrowDown":
        return done({ ...state, focus: step(entries, state.focus, 1) });
      case "ArrowUp":
        return done({ ...state, focus: step(entries, state.focus, -1) });
      case "Enter":
        return entry ? done(state, { type: "open", url: entry.url }) : done(state);
      case "Escape":
        return done(reshown({ ...state, mode: "normal", query: "" }));
      case "Tab":
        // Keep focus in the input.
        return done(state);
      default:
        // Everything else is typing.
        return { state, effects: [], handled: false };
    }
  }

  switch (key) {
    case "j":
    case "ArrowDown":
      return done({ ...state, focus: step(entries, state.focus, 1) });
    case "k":
    case "ArrowUp":
      return done({ ...state, focus: step(entries, state.focus, -1) });
    case "/":
      return done({ ...state, mode: "search", query: "" });
    case "Escape":
      return done(state, { type: "closePopup" });
    case "Enter":
    case "l":
      return entry ? done(state, { type: "open", url: entry.url }) : done(state);
    case "x":
      return entry ? done(state, { type: "remove", url: entry.url }) : done(state);
    case "y":
      return entry ? done(state, { type: "copy", urls: [entry.url] }) : done(state);
    case "r":
      return entry ? done(state, { type: "setRead", url: entry.url, read: !entry.read }) : done(state);
    case "s": {
      const sort = SORT_ORDERS[(SORT_ORDERS.indexOf(state.sort) + 1) % SORT_ORDERS.length]!;
      const next = reshown({ ...state, sort });
      return done(next, { type: "savePrefs", prefs: prefsOf(next) });
    }
    case "h": {
      const next = reshown({ ...state, hideRead: !state.hideRead });
      return done(next, { type: "savePrefs", prefs: prefsOf(next) });
    }
    default:
      return { state, effects: [], handled: false };
  }
}
