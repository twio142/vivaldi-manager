import type { ReadingListEntry } from "../protocol/types";

// The reading list view's keyboard state machine, pure like the tabs view's. Entries are keyed by
// URL, as in Vivaldi, so focus is a URL.

export interface ReadingListViewState {
  focus: string | null;
}

export type ReadingListEffect =
  | { type: "open"; url: string }
  | { type: "remove"; url: string }
  | { type: "copy"; urls: string[] }
  | { type: "setRead"; url: string; read: boolean }
  | { type: "closePopup" };

export interface ReadingListKeyResult {
  state: ReadingListViewState;
  effects: ReadingListEffect[];
  handled: boolean;
}

/** Newest first, as Vivaldi's "Sort by Date Updated". Other sort options come in Phase 4. */
export function sortEntries(entries: ReadingListEntry[]): ReadingListEntry[] {
  return [...entries].sort((a, b) => b.lastUpdate - a.lastUpdate);
}

export function initialReadingListState(entries: ReadingListEntry[]): ReadingListViewState {
  return { focus: entries[0]?.url ?? null };
}

/** Keeps focus valid after the entries change; a removed entry passes focus to the next one. */
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
  return { focus: survivor?.url ?? newEntries[0]?.url ?? null };
}

function step(entries: ReadingListEntry[], focus: string | null, dir: 1 | -1): string | null {
  if (entries.length === 0) return null;
  const index = entries.findIndex((e) => e.url === focus);
  if (index === -1) return entries[dir === 1 ? 0 : entries.length - 1]!.url;
  return entries[(index + dir + entries.length) % entries.length]!.url;
}

export function handleReadingListKey(
  state: ReadingListViewState,
  entries: ReadingListEntry[],
  key: string,
): ReadingListKeyResult {
  const done = (next: ReadingListViewState, ...effects: ReadingListEffect[]) => ({
    state: next,
    effects,
    handled: true,
  });
  const entry = entries.find((e) => e.url === state.focus);
  switch (key) {
    case "j":
    case "ArrowDown":
      return done({ focus: step(entries, state.focus, 1) });
    case "k":
    case "ArrowUp":
      return done({ focus: step(entries, state.focus, -1) });
    case "Escape":
      return done(state, { type: "closePopup" });
    case "Enter":
      return entry ? done(state, { type: "open", url: entry.url }) : done(state);
    case "x":
      return entry ? done(state, { type: "remove", url: entry.url }) : done(state);
    case "y":
      return entry ? done(state, { type: "copy", urls: [entry.url] }) : done(state);
    case "r":
      return entry ? done(state, { type: "setRead", url: entry.url, read: !entry.read }) : done(state);
    default:
      return { state, effects: [], handled: false };
  }
}
