import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../protocol/fixture";
import { buildRows } from "./rows";
import { handleKey, initialState, reconcile, type TabsViewState } from "./tabsView";

const STACK_A = "6f1c2a9e-0000-4000-8000-000000000001";
const STACK_B = "6f1c2a9e-0000-4000-8000-000000000002";

// Rows: Default [1, 2, 3] · Work [10, A(11, 12, 13), B(14, 15), 16] · Games [20, 21] · Reading []
const rows = buildRows(sampleSnapshot());
const start = (changes: Partial<TabsViewState> = {}): TabsViewState => ({ ...initialState(rows, 12), ...changes });

/** Presses keys in order; returns the final state and every effect along the way. */
function press(state: TabsViewState, ...keys: string[]) {
  const effects = [];
  for (const key of keys) {
    const result = handleKey(state, rows, key);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

describe("focus", () => {
  it("starts on the active tab", () => {
    expect(start().focus).toBe("tab:12");
  });

  it("skips workspace rows and wraps around", () => {
    expect(press(start({ focus: "tab:3" }), "j").state.focus).toBe("tab:10");
    expect(press(start({ focus: "tab:21" }), "j").state.focus).toBe("tab:1");
    expect(press(start({ focus: "tab:1" }), "k").state.focus).toBe("tab:21");
  });

  it("bypasses tabs in stacks with J/K", () => {
    expect(press(start({ focus: "tab:10" }), "J").state.focus).toBe("stack:" + STACK_A);
    expect(press(start({ focus: "tab:10" }), "J", "J").state.focus).toBe("stack:" + STACK_B);
    expect(press(start({ focus: "tab:10" }), "J", "J", "J").state.focus).toBe("tab:16");
    expect(press(start({ focus: "tab:16" }), "K").state.focus).toBe("stack:" + STACK_B);
  });
});

describe("selection", () => {
  it("selects a stack's tabs and moves past them", () => {
    const { state } = press(start({ focus: "stack:" + STACK_A }), "Tab");
    expect([...state.selection]).toEqual([11, 12, 13]);
    expect(state.focus).toBe("stack:" + STACK_B);
  });

  it("toggles a row off again", () => {
    const { state } = press(start({ focus: "tab:2" }), "Tab", "k", "Tab");
    expect(state.selection.size).toBe(0);
  });

  it("can't span workspaces", () => {
    const { state } = press(start({ focus: "tab:16" }), "Tab", "j", "Tab");
    expect([...state.selection]).toEqual([16]);
  });

  it("doesn't affect move mode, which moves only the focused row", () => {
    const { effects } = press(start({ focus: "tab:2" }), "Tab", "k", "v", "j");
    expect(effects).toEqual([
      { type: "move", args: { tabIds: [2], target: { tabId: 3 }, position: "after", intoStack: false } },
    ]);
  });
});

describe("actions", () => {
  it("closes the focused tab, a whole stack, or the selection", () => {
    expect(press(start({ focus: "tab:2" }), "x").effects).toEqual([{ type: "close", tabIds: [2] }]);
    expect(press(start({ focus: "stack:" + STACK_A }), "x").effects).toEqual([{ type: "close", tabIds: [11, 12, 13] }]);
    const { state, effects } = press(start({ focus: "tab:2" }), "Tab", "Tab", "x");
    expect(effects).toEqual([{ type: "close", tabIds: [2, 3] }]);
    expect(state.selection.size).toBe(0);
  });

  it("activates a tab, or a stack's active tab", () => {
    expect(press(start({ focus: "tab:2" }), "Enter").effects).toEqual([{ type: "activate", tabId: 2 }]);
    expect(press(start({ focus: "stack:" + STACK_A }), "Enter").effects).toEqual([{ type: "activate", tabId: 12 }]);
  });

  it("copies URLs", () => {
    expect(press(start({ focus: "stack:" + STACK_B }), "y").effects).toEqual([
      { type: "copy", urls: ["https://ci.example.com/builds/482", "https://ci.example.com/builds/481"] },
    ]);
  });

  it("adds every tab in the window with S", () => {
    const [effect] = press(start(), "S").effects;
    expect(effect?.type === "addToReadingList" && effect.items.length).toBe(12);
  });

  it("stacks two or more selected tabs with g", () => {
    expect(press(start({ focus: "tab:2" }), "g").effects).toEqual([]);
    expect(press(start({ focus: "tab:2" }), "Tab", "Tab", "g").effects).toEqual([
      { type: "createStack", tabIds: [2, 3] },
    ]);
  });

  it("dissolves a stack, or takes a tab out of it, with G", () => {
    expect(press(start({ focus: "stack:" + STACK_A }), "G").effects).toEqual([
      { type: "dissolveStack", stackId: STACK_A },
    ]);
    expect(press(start({ focus: "tab:13" }), "G").effects).toEqual([{ type: "removeFromStack", tabIds: [13] }]);
  });
});

describe("modes", () => {
  it("closes the popup on esc in normal mode", () => {
    expect(press(start({ focus: "tab:2" }), "Tab", "Escape").effects).toEqual([{ type: "closePopup" }]);
  });

  it("moves the focused row in move mode, and exits with esc", () => {
    const { state, effects } = press(start({ focus: "tab:2" }), "v", "j", "Escape");
    expect(effects).toEqual([
      { type: "move", args: { tabIds: [2], target: { tabId: 3 }, position: "after", intoStack: false } },
    ]);
    expect(state.mode).toBe("normal");
    expect(state.focus).toBe("tab:2");
  });

  it("leaves letters to the search input", () => {
    const state = press(start(), "/").state;
    expect(state.mode).toBe("search");
    expect(handleKey(state, rows, "j").handled).toBe(false);
  });

  it("leaves search on enter when a stack is focused", () => {
    const { state, effects } = press(start({ focus: "stack:" + STACK_A }), "/", "Enter");
    expect(state).toMatchObject({ mode: "normal", focus: "stack:" + STACK_A });
    expect(effects).toEqual([]);
  });
});

describe("reconcile", () => {
  it("moves focus to the next row when the focused tab goes away", () => {
    const snapshot = sampleSnapshot();
    const stack = snapshot.workspaces[1]!.items[1]!;
    if (stack.type === "stack") stack.tabs = stack.tabs.filter((t) => t.id !== 12);
    const next = reconcile(start({ selection: new Set([12, 13]) }), rows, buildRows(snapshot));
    expect(next.focus).toBe("tab:13");
    expect([...next.selection]).toEqual([13]);
  });
});
