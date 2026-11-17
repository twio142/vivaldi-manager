import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../protocol/fixture";
import { computeMove } from "./move";
import { buildRows } from "./rows";

const READING = 1700000000003;
const STACK_A = "6f1c2a9e-0000-4000-8000-000000000001";
const STACK_B = "6f1c2a9e-0000-4000-8000-000000000002";

// Rows: Default [1, 2, 3] · Work [10, A(11, 12, 13), B(14, 15), 16] · Games [20, 21] · Reading []
const rows = buildRows(sampleSnapshot());
const move = (key: string, dir: 1 | -1, over = false) => computeMove(rows, key, dir, over);

describe("computeMove", () => {
  it("swaps loose tabs", () => {
    expect(move("tab:2", 1)).toEqual({ tabIds: [2], target: { tabId: 3 }, position: "after", intoStack: false });
    expect(move("tab:3", -1)).toEqual({ tabIds: [3], target: { tabId: 2 }, position: "before", intoStack: false });
  });

  it("enters a stack from above at its top, or jumps over it with J", () => {
    expect(move("tab:10", 1)).toEqual({ tabIds: [10], target: { tabId: 11 }, position: "before", intoStack: true });
    expect(move("tab:10", 1, true)).toEqual({
      tabIds: [10],
      target: { stackId: STACK_A },
      position: "after",
      intoStack: false,
    });
  });

  it("enters a stack from below at its bottom, or jumps over it with K", () => {
    expect(move("tab:16", -1)).toEqual({ tabIds: [16], target: { tabId: 15 }, position: "after", intoStack: true });
    expect(move("tab:16", -1, true)).toEqual({
      tabIds: [16],
      target: { stackId: STACK_B },
      position: "before",
      intoStack: false,
    });
  });

  it("reorders inside a stack", () => {
    expect(move("tab:11", 1)).toEqual({ tabIds: [11], target: { tabId: 12 }, position: "after", intoStack: true });
    expect(move("tab:12", -1)).toEqual({ tabIds: [12], target: { tabId: 11 }, position: "before", intoStack: true });
  });

  it("leaves a stack past its edge", () => {
    expect(move("tab:13", 1)).toEqual({
      tabIds: [13],
      target: { stackId: STACK_A },
      position: "after",
      intoStack: false,
    });
    expect(move("tab:11", -1)).toEqual({
      tabIds: [11],
      target: { stackId: STACK_A },
      position: "before",
      intoStack: false,
    });
  });

  it("moves a whole stack over its neighbours, never into a stack", () => {
    expect(move("stack:" + STACK_A, 1)).toEqual({
      stackIds: [STACK_A],
      target: { stackId: STACK_B },
      position: "after",
      intoStack: false,
    });
    expect(move("stack:" + STACK_B, -1)).toEqual({
      stackIds: [STACK_B],
      target: { stackId: STACK_A },
      position: "before",
      intoStack: false,
    });
    expect(move("stack:" + STACK_A, -1)).toEqual({
      stackIds: [STACK_A],
      target: { tabId: 10 },
      position: "before",
      intoStack: false,
    });
  });

  it("crosses into the next workspace at its top", () => {
    expect(move("tab:3", 1)).toEqual({ tabIds: [3], target: { tabId: 10 }, position: "before", intoStack: false });
  });

  it("crosses into the previous workspace at its bottom", () => {
    expect(move("tab:20", -1)).toEqual({ tabIds: [20], target: { tabId: 16 }, position: "after", intoStack: false });
  });

  it("stops in an empty workspace", () => {
    expect(move("tab:21", 1)).toEqual({
      tabIds: [21],
      target: { workspaceId: READING },
      position: "after",
      intoStack: false,
    });
  });

  it("doesn't wrap", () => {
    expect(move("tab:1", -1)).toBeNull();
    expect(computeMove(rows.slice(0, -1), "tab:21", 1)).toBeNull();
  });
});
