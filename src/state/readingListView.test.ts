import { describe, expect, it } from "vitest";
import { sampleReadingList } from "../protocol/fixture";
import {
  handleReadingListKey,
  initialReadingListState,
  reconcileReadingList,
  sortEntries,
  type ReadingListViewState,
} from "./readingListView";

const entries = sortEntries(sampleReadingList());
const urls = entries.map((e) => e.url);

function press(state: ReadingListViewState, ...keys: string[]) {
  const effects = [];
  for (const key of keys) {
    const result = handleReadingListKey(state, entries, key);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

describe("reading list view", () => {
  it("sorts newest first and focuses the top entry", () => {
    expect(urls).toEqual([
      "https://essays.example.com/fuzzy",
      "https://blog.example.com/keyboard-first",
      "https://news.example.com/browsers",
      "file:///Users/example/notes.html",
    ]);
    expect(initialReadingListState(entries).focus).toBe(urls[0]);
  });

  it("moves focus with wrap-around", () => {
    const start = initialReadingListState(entries);
    expect(press(start, "j").state.focus).toBe(urls[1]);
    expect(press(start, "k").state.focus).toBe(urls[3]);
  });

  it("opens, removes, copies and toggles read on the focused entry", () => {
    const state = { focus: urls[2]! };
    expect(press(state, "Enter").effects).toEqual([{ type: "open", url: urls[2] }]);
    expect(press(state, "x").effects).toEqual([{ type: "remove", url: urls[2] }]);
    expect(press(state, "y").effects).toEqual([{ type: "copy", urls: [urls[2]] }]);
    // urls[2] is the read one.
    expect(press(state, "r").effects).toEqual([{ type: "setRead", url: urls[2], read: false }]);
  });

  it("closes the popup on esc", () => {
    expect(press({ focus: null }, "Escape").effects).toEqual([{ type: "closePopup" }]);
  });

  it("passes focus to the next entry when the focused one is removed", () => {
    const without = entries.filter((e) => e.url !== urls[1]);
    expect(reconcileReadingList({ focus: urls[1]! }, entries, without).focus).toBe(urls[2]);
  });
});
