import {
  API,
  PROTOCOL_VERSION,
  VIVALDI_ID,
  type AddToReadingListResult,
  type MoveTabsArgs,
  type PingResult,
  type PushMessage,
  type ReadingListEntry,
  type StackColor,
  type TabsSnapshot,
} from "./types";

/** The mod answered `{ error }`, or the call failed for another reason. */
export class ModError extends Error {
  override name = "ModError";
}

/** No copy of the mod answered for this window: not installed, outdated, or it doesn't know the window. */
export class ModNotInstalledError extends Error {
  override name = "ModNotInstalledError";
  constructor(cause?: string) {
    super("Vivaldi mod not installed", { cause });
  }
}

/** Everything the extension can ask of Vivaldi. Implemented by the real client and by the mock. */
export interface VivaldiClient {
  readonly windowId: number;
  ping(): Promise<PingResult>;
  /** Starts pushes for this window. Register `onTabs`/`onReadingList` first. */
  subscribe(): Promise<void>;
  getTabs(): Promise<TabsSnapshot>;
  activateTab(tabId: number): Promise<void>;
  closeTabs(tabIds: number[]): Promise<void>;
  moveTabs(args: MoveTabsArgs): Promise<void>;
  setPinned(tabIds: number[], pinned: boolean): Promise<void>;
  createStack(tabIds: number[]): Promise<string>;
  removeFromStack(tabIds: number[]): Promise<void>;
  dissolveStack(stackId: string): Promise<void>;
  renameStack(stackId: string, name: string): Promise<void>;
  setStackColor(stackId: string, color: StackColor | null): Promise<void>;
  addToReadingList(items: { url: string; title: string }[]): Promise<AddToReadingListResult>;
  getReadingList(): Promise<ReadingListEntry[]>;
  setRead(url: string, read: boolean): Promise<void>;
  removeFromReadingList(url: string): Promise<void>;
  openReadingListItem(url: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onTabs(listener: (snapshot: TabsSnapshot) => void): () => void;
  onReadingList(listener: (entries: ReadingListEntry[]) => void): () => void;
  dispose(): void;
}

type ExternalListener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (response?: unknown) => void,
) => void;

/** The slice of `chrome.runtime` the client uses, so tests can pass a fake. */
export interface RuntimeLike {
  sendMessage(extensionId: string, message: unknown): Promise<unknown>;
  onMessageExternal: {
    addListener(listener: ExternalListener): void;
    removeListener(listener: ExternalListener): void;
  };
}

/** The slice of `chrome.tabs` the client uses. Pinning is plain Chromium, so it skips the mod. */
export interface TabsLike {
  update(tabId: number, props: { pinned: boolean }): Promise<unknown>;
}

const NOT_INSTALLED = [/Receiving end does not exist/i, /message port closed before a response/i];

function isPush(message: unknown): message is PushMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { api?: unknown }).api === API &&
    typeof (message as { push?: unknown }).push === "string"
  );
}

export function createVivaldiClient(
  windowId: number,
  runtime: RuntimeLike = chrome.runtime as unknown as RuntimeLike,
  /** Defaults to `chrome.tabs`, looked up on use so tests that never pin don't need it. */
  tabs?: TabsLike,
): VivaldiClient {
  const tabsListeners = new Set<(snapshot: TabsSnapshot) => void>();
  const readingListListeners = new Set<(entries: ReadingListEntry[]) => void>();

  const onExternal: ExternalListener = (message, sender, sendResponse) => {
    if (sender.id !== VIVALDI_ID || !isPush(message)) return;
    // Pushes reach every page of this extension. Not replying to another window's push tells
    // that window's mod nobody is listening.
    if (message.windowId !== windowId) return;
    if (message.push === "tabs") {
      for (const listener of tabsListeners) listener(message.snapshot);
    } else if (message.push === "readingList") {
      for (const listener of readingListListeners) listener(message.entries);
    } else {
      return;
    }
    // Anything but this reply makes the mod stop pushing until the next subscribe.
    sendResponse({ ok: true });
  };
  runtime.onMessageExternal.addListener(onExternal);

  async function request<T extends object = object>(action: string, args: object = {}): Promise<T> {
    let response: unknown;
    try {
      response = await runtime.sendMessage(VIVALDI_ID, {
        api: API,
        v: PROTOCOL_VERSION,
        windowId,
        action,
        ...args,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (NOT_INSTALLED.some((re) => re.test(message))) throw new ModNotInstalledError(message);
      throw new ModError(message);
    }
    if (typeof response !== "object" || response === null) {
      throw new ModError(`Empty response to "${action}"`);
    }
    const { error } = response as { error?: unknown };
    if (error !== undefined) throw new ModError(String(error));
    return response as T;
  }

  return {
    windowId,
    ping: () => request<PingResult>("ping"),
    subscribe: async () => {
      await request("subscribe");
    },
    getTabs: async () => (await request<{ snapshot: TabsSnapshot }>("getTabs")).snapshot,
    activateTab: async (tabId) => {
      await request("activateTab", { tabId });
    },
    closeTabs: async (tabIds) => {
      await request("closeTabs", { tabIds });
    },
    moveTabs: async (args) => {
      await request("moveTabs", args);
    },
    setPinned: async (tabIds, pinned) => {
      // No `tabs` permission needed: it only gates reading URLs and titles. The mod's next push
      // shows the result, with the tabs moved to or from the front of the strip.
      try {
        const api = tabs ?? chrome.tabs;
        await Promise.all(tabIds.map((id) => api.update(id, { pinned })));
      } catch (e) {
        throw new ModError(e instanceof Error ? e.message : String(e));
      }
    },
    createStack: async (tabIds) => (await request<{ stackId: string }>("createStack", { tabIds })).stackId,
    removeFromStack: async (tabIds) => {
      await request("removeFromStack", { tabIds });
    },
    dissolveStack: async (stackId) => {
      await request("dissolveStack", { stackId });
    },
    renameStack: async (stackId, name) => {
      await request("renameStack", { stackId, name });
    },
    setStackColor: async (stackId, color) => {
      await request("setStackColor", { stackId, color });
    },
    addToReadingList: async (items) => {
      const { added, skipped } = await request<AddToReadingListResult>("addToReadingList", { items });
      return { added, skipped };
    },
    getReadingList: async () => (await request<{ entries: ReadingListEntry[] }>("getReadingList")).entries,
    setRead: async (url, read) => {
      await request("setRead", { url, read });
    },
    removeFromReadingList: async (url) => {
      await request("removeFromReadingList", { url });
    },
    openReadingListItem: async (url) => {
      await request("openReadingListItem", { url });
    },
    onTabs: (listener) => {
      tabsListeners.add(listener);
      return () => tabsListeners.delete(listener);
    },
    onReadingList: (listener) => {
      readingListListeners.add(listener);
      return () => readingListListeners.delete(listener);
    },
    dispose: () => {
      runtime.onMessageExternal.removeListener(onExternal);
      tabsListeners.clear();
      readingListListeners.clear();
    },
  };
}
