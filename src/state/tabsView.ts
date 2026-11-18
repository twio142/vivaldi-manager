import { STACK_COLORS, type MoveTabsArgs, type StackColor, type Tab } from "../protocol/types";
import { computeMove } from "./move";
import { isFocusable, rowTabs, stackKey, stepFocus, tabKey, type Row, type StackRow, type TabRow } from "./rows";
import type { SearchResult } from "./search";

// The tabs view's keyboard state machine. `handleKey` is pure: it returns the next state plus the
// effects (calls to the mod, clipboard writes) for the UI to carry out.

/** `rename` and `color` edit the focused stack row. */
export type Mode = "normal" | "move" | "search" | "rename" | "color";

export interface TabsViewState {
  mode: Mode;
  /** Row key, or null when there are no focusable rows. */
  focus: string | null;
  /** Selected tab ids. All in one workspace. */
  selection: ReadonlySet<number>;
  query: string;
  /** Rename mode: the name being typed. */
  draft: string;
  /** Color mode: the colors on offer (`null` = no color) and the highlighted one. */
  colors: (StackColor | null)[];
  colorIndex: number;
  /** A row to focus as soon as it shows up, e.g. a stack that's being created. */
  pendingFocus: string | null;
}

const ALL_COLORS = [...(Object.keys(STACK_COLORS) as StackColor[]), null];

export type Effect =
  | { type: "activate"; tabId: number }
  | { type: "close"; tabIds: number[] }
  | { type: "move"; args: MoveTabsArgs }
  | { type: "copy"; urls: string[] }
  | { type: "addToReadingList"; items: { url: string; title: string }[] }
  | { type: "createStack"; tabIds: number[] }
  | { type: "removeFromStack"; tabIds: number[] }
  | { type: "dissolveStack"; stackId: string }
  | { type: "renameStack"; stackId: string; name: string }
  | { type: "setStackColor"; stackId: string; color: StackColor | null }
  | { type: "closePopup" };

export interface KeyResult {
  state: TabsViewState;
  effects: Effect[];
  /** False when the key means nothing here, so the UI can let it through (e.g. to the search input). */
  handled: boolean;
}

const EMPTY = new Set<number>();

export function initialState(rows: Row[], activeTabId: number): TabsViewState {
  const active = tabKey(activeTabId);
  const focus = rows.some((r) => r.key === active) ? active : (rows.find(isFocusable)?.key ?? null);
  return { mode: "normal", focus, selection: EMPTY, query: "", draft: "", colors: [], colorIndex: 0, pendingFocus: null };
}

/** Keeps focus and selection valid after the rows change (a new snapshot, or a search filter). */
export function reconcile(state: TabsViewState, oldRows: Row[], newRows: Row[]): TabsViewState {
  const present = new Set(newRows.filter(isFocusable).map((r) => r.key));
  let focus = state.focus;
  let { mode, pendingFocus } = state;
  if (pendingFocus !== null && present.has(pendingFocus)) {
    focus = pendingFocus;
    pendingFocus = null;
  } else if (focus === null || !present.has(focus)) {
    // Fall to the nearest surviving row, looking down first, as after closing a tab.
    const index = oldRows.findIndex((r) => r.key === focus);
    const survivor =
      index === -1
        ? undefined
        : (oldRows.slice(index + 1).find((r) => present.has(r.key)) ??
          oldRows.slice(0, index).findLast((r) => present.has(r.key)));
    focus = survivor?.key ?? newRows.find(isFocusable)?.key ?? null;
  }
  // The stack being edited went away (closed, or dissolved elsewhere).
  if ((mode === "rename" || mode === "color") && focus !== state.focus) mode = "normal";
  const tabIds = new Set(newRows.flatMap((r) => (r.kind === "tab" ? [r.tab.id] : [])));
  const selection = [...state.selection].filter((id) => tabIds.has(id));
  return {
    ...state,
    mode,
    focus,
    pendingFocus,
    selection: selection.length === state.selection.size ? state.selection : new Set(selection),
  };
}

/** A new search query: focus jumps to its best match, as in fzf. */
export function setQuery(state: TabsViewState, query: string, result: SearchResult): TabsViewState {
  const focus = result.best ?? result.rows.find(isFocusable)?.key ?? state.focus;
  return { ...state, query, focus };
}

export function setDraft(state: TabsViewState, draft: string): TabsViewState {
  return { ...state, draft };
}

/** Focuses `key` now if it's in `rows`, else as soon as a later `reconcile` sees it. */
export function focusWhenPresent(state: TabsViewState, rows: Row[], key: string): TabsViewState {
  return rows.some((r) => r.key === key) ? { ...state, focus: key, pendingFocus: null } : { ...state, pendingFocus: key };
}

export function handleKey(state: TabsViewState, rows: Row[], key: string): KeyResult {
  const result = modeKey(state, rows, key);
  // Acting on the list cancels a pending focus jump, so it can't pull focus away later.
  return result.handled && result.state.pendingFocus !== null
    ? { ...result, state: { ...result.state, pendingFocus: null } }
    : result;
}

function modeKey(state: TabsViewState, rows: Row[], key: string): KeyResult {
  switch (state.mode) {
    case "normal":
      return normalKey(state, rows, key);
    case "move":
      return moveKey(state, rows, key);
    case "search":
      return searchKey(state, rows, key);
    case "rename":
      return renameKey(state, rows, key);
    case "color":
      return colorKey(state, rows, key);
  }
}

const done = (state: TabsViewState, ...effects: Effect[]): KeyResult => ({ state, effects, handled: true });
const ignored = (state: TabsViewState): KeyResult => ({ state, effects: [], handled: false });

function focusedRow(state: TabsViewState, rows: Row[]): Row | undefined {
  return rows.find((r) => r.key === state.focus);
}

/** Selected tabs in display order, else the focused row's tabs. */
function targetTabs(state: TabsViewState, rows: Row[]): Tab[] {
  if (state.selection.size > 0) {
    return rows.flatMap((r) => (r.kind === "tab" && state.selection.has(r.tab.id) ? [r.tab] : []));
  }
  const row = focusedRow(state, rows);
  return row ? rowTabs(row) : [];
}

const asItems = (tabs: Tab[]) => tabs.map(({ url, title }) => ({ url, title }));

/** The tab `enter` activates on a stack row: its active tab, else its first. */
function stackEntryTab(row: StackRow): Tab {
  return row.stack.tabs.find((t) => t.active) ?? row.stack.tabs[0]!;
}

function toggleSelect(state: TabsViewState, rows: Row[]): KeyResult {
  const row = focusedRow(state, rows);
  if (!row || row.kind === "workspace") return done(state);
  // Selection can't span workspaces.
  const selected = rows.find((r): r is TabRow => r.kind === "tab" && state.selection.has(r.tab.id));
  if (selected && selected.workspaceId !== row.workspaceId) return done(state);

  const ids = rowTabs(row).map((t) => t.id);
  const selection = new Set(state.selection);
  const allSelected = ids.every((id) => selection.has(id));
  for (const id of ids) {
    if (allSelected) selection.delete(id);
    else selection.add(id);
  }
  // After a stack row, continue below its tabs; they were just selected with it.
  const focus = stepFocus(rows, state.focus, 1, row.kind === "stack");
  return done({ ...state, selection, focus });
}

function normalKey(state: TabsViewState, rows: Row[], key: string): KeyResult {
  const row = focusedRow(state, rows);
  switch (key) {
    case "j":
    case "ArrowDown":
      return done({ ...state, focus: stepFocus(rows, state.focus, 1) });
    case "k":
    case "ArrowUp":
      return done({ ...state, focus: stepFocus(rows, state.focus, -1) });
    case "J":
      return done({ ...state, focus: stepFocus(rows, state.focus, 1, true) });
    case "K":
      return done({ ...state, focus: stepFocus(rows, state.focus, -1, true) });
    case "Tab":
      return toggleSelect(state, rows);
    case "v":
      return row && row.kind !== "workspace" ? done({ ...state, mode: "move" }) : done(state);
    case "/":
      return done({ ...state, mode: "search", query: "" });
    case "Escape":
      return done(state, { type: "closePopup" });
    case "Enter":
    case "l":
      if (row?.kind === "tab") return done(state, { type: "activate", tabId: row.tab.id });
      if (row?.kind === "stack") return done(state, { type: "activate", tabId: stackEntryTab(row).id });
      return done(state);
    case "h":
      // From a stacked tab up to its stack row.
      return row?.kind === "tab" && row.stackId !== null
        ? done({ ...state, focus: stackKey(row.stackId) })
        : done(state);
    case "x": {
      const tabs = targetTabs(state, rows);
      return tabs.length > 0
        ? done({ ...state, selection: EMPTY }, { type: "close", tabIds: tabs.map((t) => t.id) })
        : done(state);
    }
    case "y": {
      const tabs = targetTabs(state, rows);
      return tabs.length > 0 ? done(state, { type: "copy", urls: tabs.map((t) => t.url) }) : done(state);
    }
    case "s": {
      const tabs = targetTabs(state, rows);
      return tabs.length > 0
        ? done({ ...state, selection: EMPTY }, { type: "addToReadingList", items: asItems(tabs) })
        : done(state);
    }
    case "S": {
      const tabs = rows.flatMap((r) => (r.kind === "tab" ? [r.tab] : []));
      return tabs.length > 0 ? done(state, { type: "addToReadingList", items: asItems(tabs) }) : done(state);
    }
    case "g": {
      // A stack of one isn't a stack, so it takes at least two selected tabs.
      const tabs = targetTabs(state, rows);
      return state.selection.size >= 2
        ? done({ ...state, selection: EMPTY }, { type: "createStack", tabIds: tabs.map((t) => t.id) })
        : done(state);
    }
    case "G": {
      if (state.selection.size > 0) {
        const stacked = rows.flatMap((r) =>
          r.kind === "tab" && r.stackId !== null && state.selection.has(r.tab.id) ? [r.tab.id] : [],
        );
        return stacked.length > 0
          ? done({ ...state, selection: EMPTY }, { type: "removeFromStack", tabIds: stacked })
          : done(state);
      }
      if (row?.kind === "stack") return done(state, { type: "dissolveStack", stackId: row.stack.id });
      if (row?.kind === "tab" && row.stackId !== null) {
        return done(state, { type: "removeFromStack", tabIds: [row.tab.id] });
      }
      return done(state);
    }
    case "i":
      // Prefilled with the shown name, custom or not.
      return row?.kind === "stack" ? done({ ...state, mode: "rename", draft: row.stack.name }) : done(state);
    case "c": {
      if (row?.kind !== "stack") return done(state);
      const colors = ALL_COLORS.filter((c) => c !== row.stack.color);
      return done({ ...state, mode: "color", colors, colorIndex: 0 });
    }
    default:
      return ignored(state);
  }
}

function renameKey(state: TabsViewState, rows: Row[], key: string): KeyResult {
  const row = focusedRow(state, rows);
  switch (key) {
    case "Enter": {
      const normal = { ...state, mode: "normal" as const, draft: "" };
      if (row?.kind !== "stack") return done(normal);
      // An empty name clears the custom name, as in Vivaldi.
      const name = state.draft.trim();
      return name === row.stack.name
        ? done(normal)
        : done(normal, { type: "renameStack", stackId: row.stack.id, name });
    }
    case "Escape":
      return done({ ...state, mode: "normal", draft: "" });
    case "Tab":
      // Keep focus in the input.
      return done(state);
    default:
      // Everything else is typing.
      return ignored(state);
  }
}

function colorKey(state: TabsViewState, rows: Row[], key: string): KeyResult {
  const count = state.colors.length;
  switch (key) {
    case "l":
    case "ArrowRight":
      return done({ ...state, colorIndex: (state.colorIndex + 1) % count });
    case "h":
    case "ArrowLeft":
      return done({ ...state, colorIndex: (state.colorIndex - 1 + count) % count });
    case "Enter": {
      const row = focusedRow(state, rows);
      const normal = { ...state, mode: "normal" as const, colors: [], colorIndex: 0 };
      const color = state.colors[state.colorIndex];
      return row?.kind === "stack" && color !== undefined
        ? done(normal, { type: "setStackColor", stackId: row.stack.id, color })
        : done(normal);
    }
    case "Escape":
      return done({ ...state, mode: "normal", colors: [], colorIndex: 0 });
    default:
      // Swallow everything else, so a stray key can't act on the list mid-pick.
      return done(state);
  }
}

function moveKey(state: TabsViewState, rows: Row[], key: string): KeyResult {
  const step = { j: [1, false], ArrowDown: [1, false], k: [-1, false], ArrowUp: [-1, false], J: [1, true], K: [-1, true] } as const;
  if (key in step) {
    const [dir, over] = step[key as keyof typeof step];
    const args = state.focus === null ? null : computeMove(rows, state.focus, dir, over);
    return args ? done(state, { type: "move", args }) : done(state);
  }
  if (key === "v" || key === "Escape") return done({ ...state, mode: "normal" });
  return ignored(state);
}

function searchKey(state: TabsViewState, rows: Row[], key: string): KeyResult {
  switch (key) {
    case "ArrowDown":
      return done({ ...state, focus: stepFocus(rows, state.focus, 1) });
    case "ArrowUp":
      return done({ ...state, focus: stepFocus(rows, state.focus, -1) });
    case "Escape":
      return done({ ...state, mode: "normal", query: "" });
    case "Enter": {
      const row = focusedRow(state, rows);
      if (row?.kind === "tab") return done(state, { type: "activate", tabId: row.tab.id });
      // On a stack: leave search with the stack focused.
      if (row?.kind === "stack") return done({ ...state, mode: "normal", query: "" });
      return done(state);
    }
    case "Tab":
      // Keep focus in the input.
      return done(state);
    default:
      // Everything else is typing.
      return ignored(state);
  }
}
