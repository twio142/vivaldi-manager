import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../protocol/fixture";
import { computeDrop } from "./drop";
import { buildRows } from "./rows";

const WORK = 1700000000001;
const READING = 1700000000003;
const STACK_A = "6f1c2a9e-0000-4000-8000-000000000001";
const STACK_B = "6f1c2a9e-0000-4000-8000-000000000002";

// Rows: Default [1, 2, 3] · Work [10, A(11, 12, 13), B(14, 15), 16] · Games [20, 21] · Reading []
const rows = buildRows(sampleSnapshot());
const drop = (drag: string, over: string, half: "top" | "bottom") => computeDrop(rows, drag, over, half);

describe("computeDrop", () => {
  it("drops next to a loose tab", () => {
    expect(drop("tab:2", "tab:20", "top")).toEqual({
      args: { tabIds: [2], target: { tabId: 20 }, position: "before", intoStack: false },
      indicator: { key: "tab:20", edge: "top" },
    });
    expect(drop("tab:2", "tab:20", "bottom")?.args.position).toBe("after");
  });

  it("joins a stack when dropped on one of its tabs", () => {
    expect(drop("tab:2", "tab:12", "bottom")?.args).toEqual({
      tabIds: [2],
      target: { tabId: 12 },
      position: "after",
      intoStack: true,
    });
  });

  it("goes before a stack on its row's top half, into it on the bottom half", () => {
    expect(drop("tab:2", "stack:" + STACK_A, "top")?.args).toEqual({
      tabIds: [2],
      target: { stackId: STACK_A },
      position: "before",
      intoStack: false,
    });
    expect(drop("tab:2", "stack:" + STACK_A, "bottom")?.args).toEqual({
      tabIds: [2],
      target: { tabId: 11 },
      position: "before",
      intoStack: true,
    });
  });

  it("drops a stack beside another stack, never into it", () => {
    expect(drop("stack:" + STACK_B, "tab:12", "top")).toEqual({
      args: { stackIds: [STACK_B], target: { stackId: STACK_A }, position: "after", intoStack: false },
      indicator: { key: "tab:13", edge: "bottom" },
    });
    expect(drop("stack:" + STACK_B, "stack:" + STACK_A, "bottom")?.args).toMatchObject({
      target: { stackId: STACK_A },
      position: "after",
      intoStack: false,
    });
  });

  it("drops at the top of a workspace, or into an empty one", () => {
    expect(drop("tab:2", "ws:" + WORK, "top")?.args).toEqual({
      tabIds: [2],
      target: { tabId: 10 },
      position: "before",
      intoStack: false,
    });
    expect(drop("tab:2", "ws:" + READING, "bottom")?.args).toEqual({
      tabIds: [2],
      target: { workspaceId: READING },
      position: "after",
      intoStack: false,
    });
  });

  it("ignores drops onto the dragged row itself", () => {
    expect(drop("tab:2", "tab:2", "top")).toBeNull();
    expect(drop("stack:" + STACK_A, "tab:12", "top")).toBeNull();
  });
});
