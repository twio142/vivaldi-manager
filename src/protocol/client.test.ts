import { describe, expect, it, vi } from "vitest";
import { ModError, ModNotInstalledError, createVivaldiClient, type RuntimeLike } from "./client";
import { sampleSnapshot } from "./fixture";
import { VIVALDI_ID } from "./types";

type Listener = Parameters<RuntimeLike["onMessageExternal"]["addListener"]>[0];

function fakeRuntime(reply: (message: Record<string, unknown>) => unknown) {
  const listeners = new Set<Listener>();
  const runtime: RuntimeLike = {
    sendMessage: vi.fn(async (_id: string, message: unknown) => reply(message as Record<string, unknown>)),
    onMessageExternal: {
      addListener: (l) => listeners.add(l),
      removeListener: (l) => listeners.delete(l),
    },
  };
  /** Delivers a message as Vivaldi would; returns what the listeners answered. */
  const deliver = (message: unknown, senderId = VIVALDI_ID) => {
    const responses: unknown[] = [];
    for (const l of listeners) l(message, { id: senderId }, (r) => responses.push(r));
    return responses;
  };
  return { runtime, listeners, deliver };
}

describe("requests", () => {
  it("wraps arguments in the envelope", async () => {
    const { runtime } = fakeRuntime(() => ({ ok: true }));
    await createVivaldiClient(7, runtime).closeTabs([1, 2]);
    expect(runtime.sendMessage).toHaveBeenCalledWith(VIVALDI_ID, {
      api: "vivaldi-manager",
      v: 1,
      windowId: 7,
      action: "closeTabs",
      tabIds: [1, 2],
    });
  });

  it("unwraps results", async () => {
    const { runtime } = fakeRuntime(() => ({ ok: true, stackId: "s1" }));
    await expect(createVivaldiClient(7, runtime).createStack([1, 2])).resolves.toBe("s1");
  });

  it("pins through chrome.tabs, not the mod", async () => {
    const { runtime } = fakeRuntime(() => ({ ok: true }));
    const tabs = { update: vi.fn(async () => ({})) };
    await createVivaldiClient(7, runtime, tabs).setPinned([1, 2], true);
    expect(tabs.update.mock.calls).toEqual([
      [1, { pinned: true }],
      [2, { pinned: true }],
    ]);
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("throws the mod's error", async () => {
    const { runtime } = fakeRuntime(() => ({ error: "tab stacking is off" }));
    await expect(createVivaldiClient(7, runtime).createStack([1, 2])).rejects.toEqual(
      new ModError("tab stacking is off"),
    );
  });

  it.each([
    "Could not establish connection. Receiving end does not exist.",
    "The message port closed before a response was received.",
  ])("reports a missing mod: %s", async (message) => {
    const { runtime } = fakeRuntime(() => {
      throw new Error(message);
    });
    await expect(createVivaldiClient(7, runtime).ping()).rejects.toBeInstanceOf(ModNotInstalledError);
  });
});

describe("pushes", () => {
  const snapshot = { ...sampleSnapshot(), windowId: 7 };

  it("delivers this window's snapshots and acknowledges them", () => {
    const { runtime, deliver } = fakeRuntime(() => ({ ok: true }));
    const client = createVivaldiClient(7, runtime);
    const onTabs = vi.fn();
    client.onTabs(onTabs);
    expect(deliver({ api: "vivaldi-manager", windowId: 7, push: "tabs", snapshot })).toEqual([{ ok: true }]);
    expect(onTabs).toHaveBeenCalledWith(snapshot);
  });

  it("ignores, without replying, other windows, other senders and other messages", () => {
    const { runtime, deliver } = fakeRuntime(() => ({ ok: true }));
    const client = createVivaldiClient(8, runtime);
    const onTabs = vi.fn();
    const onReadingList = vi.fn();
    client.onTabs(onTabs);
    client.onReadingList(onReadingList);
    const responses = [
      deliver({ api: "vivaldi-manager", windowId: 7, push: "tabs", snapshot }),
      deliver({ api: "vivaldi-manager", windowId: 7, push: "readingList", entries: [] }),
      deliver({ api: "vivaldi-manager", windowId: 8, push: "tabs", snapshot }, "someone-else"),
      deliver({ api: "other", windowId: 8, push: "tabs", snapshot }),
      deliver({ api: "vivaldi-manager", windowId: 8, push: "unknown" }),
    ];
    expect(responses.flat()).toEqual([]);
    expect(onTabs).not.toHaveBeenCalled();
    expect(onReadingList).not.toHaveBeenCalled();
  });

  it("delivers this window's reading list pushes and acknowledges them", () => {
    const { runtime, deliver } = fakeRuntime(() => ({ ok: true }));
    const client = createVivaldiClient(7, runtime);
    const onReadingList = vi.fn();
    client.onReadingList(onReadingList);
    expect(deliver({ api: "vivaldi-manager", windowId: 7, push: "readingList", entries: [] })).toEqual([{ ok: true }]);
    expect(onReadingList).toHaveBeenCalledWith([]);
  });

  it("stops listening on dispose", () => {
    const { runtime, listeners } = fakeRuntime(() => ({ ok: true }));
    createVivaldiClient(7, runtime).dispose();
    expect(listeners.size).toBe(0);
  });
});
