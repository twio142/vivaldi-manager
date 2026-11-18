import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModError } from "./client";
import { createMockClient } from "./mock";
import type { TabsSnapshot } from "./types";

const WORK = 1700000000001;
const STACK_A = "6f1c2a9e-0000-4000-8000-000000000001";

const workIds = (snapshot: TabsSnapshot) =>
  snapshot.workspaces
    .find((w) => w.id === WORK)!
    .items.map((item) => (item.type === "stack" ? [item.id, ...item.tabs.map((t) => t.id)] : item.id));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function subscribed() {
  const client = createMockClient({ now: () => 1234 });
  const onTabs = vi.fn<(snapshot: TabsSnapshot) => void>();
  const onReadingList = vi.fn();
  client.onTabs(onTabs);
  client.onReadingList(onReadingList);
  await client.subscribe();
  await vi.runAllTimersAsync();
  const latest = () => onTabs.mock.lastCall![0];
  return { client, onTabs, onReadingList, latest };
}

describe("mock client", () => {
  it("pushes both lists right after subscribe", async () => {
    const { onTabs, onReadingList } = await subscribed();
    expect(onTabs).toHaveBeenCalledOnce();
    expect(onReadingList).toHaveBeenCalledOnce();
  });

  it("pushes a debounced snapshot after changes", async () => {
    const { client, onTabs, latest } = await subscribed();
    await client.moveTabs({ tabIds: [10], target: { tabId: 16 }, position: "after" });
    await client.moveTabs({ tabIds: [16], target: { tabId: 10 }, position: "after" });
    expect(onTabs).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50);
    expect(onTabs).toHaveBeenCalledTimes(2);
    expect(workIds(latest())).toEqual([[STACK_A, 11, 12, 13], expect.any(Array), 10, 16]);
  });

  it("creates a stack in place of its first tab", async () => {
    const { client, latest } = await subscribed();
    const stackId = await client.createStack([10, 16]);
    await vi.runAllTimersAsync();
    expect(workIds(latest())[0]).toEqual([stackId, 10, 16]);
  });

  it("puts tabs taken out of a stack right after it, in order", async () => {
    const { client, latest } = await subscribed();
    await client.removeFromStack([11, 12]);
    await vi.runAllTimersAsync();
    expect(workIds(latest()).slice(0, 3)).toEqual([10, 13, 11]);
  });

  it("moves pinned tabs to the front and unpinned ones after them", async () => {
    const { client, latest } = await subscribed();
    await client.setPinned([16], true);
    await vi.runAllTimersAsync();
    expect(workIds(latest())[0]).toBe(16);
    await client.setPinned([16], false);
    await vi.runAllTimersAsync();
    // As in Chromium: an unpinned tab stays put, now leading the unpinned ones.
    expect(workIds(latest()).slice(0, 2)).toEqual([16, 10]);
    expect(latest().workspaces.find((w) => w.id === WORK)!.items[0]).toMatchObject({ pinned: false });
  });

  it("activates a neighbour when the active tab closes", async () => {
    const { client, latest } = await subscribed();
    await client.closeTabs([12]);
    await vi.runAllTimersAsync();
    expect(latest().activeTabId).toBe(13);
  });

  it("skips URLs the reading list can't hold", async () => {
    const { client } = await subscribed();
    const result = await client.addToReadingList([
      { url: "vivaldi://settings/", title: "Settings" },
      { url: "https://forum.vivaldi.net/", title: "Forum" },
    ]);
    expect(result.added).toEqual(["https://forum.vivaldi.net/"]);
    expect(result.skipped.map((s) => s.url)).toEqual(["vivaldi://settings/"]);
  });

  it("opens a reading list item in a new tab and marks it read", async () => {
    const { client, latest, onReadingList } = await subscribed();
    await client.openReadingListItem("https://blog.example.com/keyboard-first");
    await vi.runAllTimersAsync();
    const snapshot = latest();
    const active = snapshot.workspaces.flatMap((w) => w.items).find((i) => i.type === "tab" && i.id === snapshot.activeTabId);
    expect(active).toMatchObject({ url: "https://blog.example.com/keyboard-first" });
    expect(onReadingList.mock.lastCall![0]).toContainEqual(
      expect.objectContaining({ url: "https://blog.example.com/keyboard-first", read: true }),
    );
  });

  it("fails with ModError", async () => {
    const client = createMockClient();
    await expect(client.activateTab(999)).rejects.toBeInstanceOf(ModError);
  });
});
