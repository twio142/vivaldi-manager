import { describe, expect, it } from "vitest";
import { sampleReadingList } from "../protocol/fixture";
import {
  handleReadingListKey,
  initialReadingListState,
  reconcileReadingList,
  setReadingListQuery,
  visibleEntries,
  type ReadingListViewState,
} from "./readingListView";

const all = sampleReadingList();
const FUZZY = "https://essays.example.com/fuzzy";
const KEYBOARD = "https://blog.example.com/keyboard-first";
const BROWSERS = "https://news.example.com/browsers"; // the read one
const NOTES = "file:///Users/example/notes.html";

/** The initial state with focus on the top entry, as the popup sets it up. */
function start(changes: Partial<ReadingListViewState> = {}): ReadingListViewState {
  const state = { ...initialReadingListState(), ...changes };
  return state.focus === null ? reconcileReadingList(state, [], visibleEntries(all, state).entries) : state;
}

function press(state: ReadingListViewState, ...keys: string[]) {
  const effects = [];
  for (const key of keys) {
    const result = handleReadingListKey(state, all, key);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const shown = (state: ReadingListViewState) => visibleEntries(all, state).entries.map((e) => e.url);

describe("reading list view", () => {
  it("sorts newest first and focuses the top entry", () => {
    expect(shown(start())).toEqual([FUZZY, KEYBOARD, BROWSERS, NOTES]);
    expect(start().focus).toBe(FUZZY);
  });

  it("moves focus with wrap-around", () => {
    expect(press(start(), "j").state.focus).toBe(KEYBOARD);
    expect(press(start(), "k").state.focus).toBe(NOTES);
  });

  it("opens, removes, copies and toggles read on the focused entry", () => {
    const state = start({ focus: BROWSERS });
    expect(press(state, "Enter").effects).toEqual([{ type: "open", url: BROWSERS }]);
    expect(press(state, "l").effects).toEqual([{ type: "open", url: BROWSERS }]);
    expect(press(state, "x").effects).toEqual([{ type: "remove", url: BROWSERS }]);
    expect(press(state, "y").effects).toEqual([{ type: "copy", urls: [BROWSERS] }]);
    expect(press(state, "r").effects).toEqual([{ type: "setRead", url: BROWSERS, read: false }]);
  });

  it("closes the popup on esc", () => {
    expect(press(start(), "Escape").effects).toEqual([{ type: "closePopup" }]);
  });

  it("passes focus to the next entry when the focused one is removed", () => {
    const entries = shown(start());
    const without = all.filter((e) => e.url !== KEYBOARD);
    const next = reconcileReadingList(
      start({ focus: KEYBOARD }),
      entries.map((url) => all.find((e) => e.url === url)!),
      visibleEntries(without, start()).entries,
    );
    expect(next.focus).toBe(BROWSERS);
  });
});

describe("sorting and hiding", () => {
  it("cycles date → title → unread first with s, and saves the choice", () => {
    const { state, effects } = press(start(), "s");
    expect(state.sort).toBe("title");
    expect(shown(state)).toEqual([KEYBOARD, FUZZY, NOTES, BROWSERS]);
    expect(effects).toEqual([{ type: "savePrefs", prefs: { sort: "title", hideRead: false } }]);
    expect(press(state, "s").state.sort).toBe("read");
    expect(shown(press(state, "s").state).at(-1)).toBe(BROWSERS);
    expect(press(state, "s", "s").state.sort).toBe("date");
  });

  it("hides read entries with h and moves focus off a hidden one", () => {
    const { state, effects } = press(start({ focus: BROWSERS }), "h");
    expect(shown(state)).not.toContain(BROWSERS);
    expect(state.focus).toBe(NOTES);
    expect(effects).toEqual([{ type: "savePrefs", prefs: { sort: "date", hideRead: true } }]);
  });
});

describe("search", () => {
  it("filters by title or URL and focuses the best match", () => {
    const state = setReadingListQuery(press(start(), "/").state, all, "fuzzy");
    expect(shown(state)).toEqual([FUZZY]);
    expect(state.focus).toBe(FUZZY);
    expect(visibleEntries(all, state).matches.get(FUZZY)?.field).toBe("title");
    expect(shown(setReadingListQuery(state, all, "news.example"))).toEqual([BROWSERS]);
  });

  it("leaves letters to the input and opens with enter", () => {
    const state = setReadingListQuery(press(start(), "/").state, all, "browsers");
    expect(handleReadingListKey(state, all, "x").handled).toBe(false);
    expect(press(state, "Enter").effects).toEqual([{ type: "open", url: BROWSERS }]);
  });

  it("clears the query on esc and keeps focus on the entry", () => {
    const state = setReadingListQuery(press(start(), "/").state, all, "notes");
    const { state: after } = press(state, "Escape");
    expect(after).toMatchObject({ mode: "normal", query: "", focus: NOTES });
    expect(shown(after)).toHaveLength(4);
  });
});
