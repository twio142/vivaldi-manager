import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../protocol/fixture";
import type { MoveTabsArgs, TabsSnapshot } from "../protocol/types";
import { applyMove, fromStrip, toStrip } from "./strip";

const WORK = 1700000000001;
const GAMES = 1700000000002;
const READING = 1700000000003;
const STACK_A = "6f1c2a9e-0000-4000-8000-000000000001";
const STACK_B = "6f1c2a9e-0000-4000-8000-000000000002";

/** Each workspace's items as ids: a number for a tab, `[stackId, ...tabIds]` for a stack. */
function layout(snapshot: TabsSnapshot) {
  return Object.fromEntries(
    snapshot.workspaces.map((ws) => [
      ws.id,
      ws.items.map((item) => (item.type === "stack" ? [item.id, ...item.tabs.map((t) => t.id)] : item.id)),
    ]),
  );
}

const move = (args: MoveTabsArgs) => fromStrip(applyMove(toStrip(sampleSnapshot()), args));

describe("toStrip / fromStrip", () => {
  it("round-trips the snapshot", () => {
    expect(fromStrip(toStrip(sampleSnapshot()))).toEqual(sampleSnapshot());
  });
});

describe("applyMove", () => {
  it("reorders next to a loose tab", () => {
    expect(layout(move({ tabIds: [2], target: { tabId: 3 }, position: "after" }))[0]).toEqual([1, 3, 2]);
  });

  it("joins a stack with intoStack", () => {
    const result = move({ tabIds: [10], target: { tabId: 12 }, position: "before", intoStack: true });
    expect(layout(result)[WORK]).toEqual([[STACK_A, 11, 10, 12, 13], [STACK_B, 14, 15], 16]);
  });

  it("goes beside the whole stack when a stacked tab is targeted without intoStack", () => {
    const result = move({ tabIds: [16], target: { tabId: 12 }, position: "before" });
    expect(layout(result)[WORK]).toEqual([10, 16, [STACK_A, 11, 12, 13], [STACK_B, 14, 15]]);
  });

  it("leaves a stack", () => {
    const result = move({ tabIds: [11], target: { stackId: STACK_A }, position: "after" });
    expect(layout(result)[WORK]).toEqual([10, [STACK_A, 12, 13], 11, [STACK_B, 14, 15], 16]);
  });

  it("shows a stack left with one tab as a plain tab", () => {
    const result = move({ tabIds: [14], target: { tabId: 16 }, position: "after" });
    expect(layout(result)[WORK]).toEqual([10, [STACK_A, 11, 12, 13], 15, 16, 14]);
  });

  it("moves across workspaces", () => {
    const result = layout(move({ tabIds: [2], target: { tabId: 20 }, position: "before" }));
    expect(result[0]).toEqual([1, 3]);
    expect(result[GAMES]).toEqual([2, 20, 21]);
  });

  it("moves into an empty workspace", () => {
    const result = move({ tabIds: [16], target: { workspaceId: READING }, position: "after" });
    expect(layout(result)[READING]).toEqual([16]);
    expect(result.workspaces.find((w) => w.id === READING)!.tabCount).toBe(1);
  });

  it("moves a whole stack and keeps its name and color", () => {
    const result = move({ stackIds: [STACK_A], target: { tabId: 21 }, position: "after" });
    expect(layout(result)[GAMES]).toEqual([20, 21, [STACK_A, 11, 12, 13]]);
    const stack = result.workspaces.find((w) => w.id === GAMES)!.items.at(-1)!;
    expect(stack).toMatchObject({ name: "Diagram Design", customName: true, color: "color2" });
  });

  it("throws on an unknown target", () => {
    expect(() => move({ tabIds: [2], target: { tabId: 999 }, position: "after" })).toThrow("Unknown tab 999");
  });
});
