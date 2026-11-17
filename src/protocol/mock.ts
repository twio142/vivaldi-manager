import { ModError, type VivaldiClient } from "./client";
import { sampleReadingList, sampleSnapshot } from "./fixture";
import type { ReadingListEntry, Tab, TabsSnapshot } from "./types";
import { applyMove, fromStrip, toStrip, type StackMeta, type Strip, type StripTab } from "../model/strip";

// An in-memory stand-in for the mod: same interface, same push behaviour, close enough
// semantics to build the UI against. Where VIVALDI.md leaves the outcome to Vivaldi
// (e.g. where `removeFromStack` puts tabs), this picks something plausible.

export interface MockOptions {
  snapshot?: TabsSnapshot;
  readingList?: ReadingListEntry[];
  /** Simulated round-trip time for every request. */
  latencyMs?: number;
  /** Debounce before a tabs push, as in the mod. */
  pushDelayMs?: number;
  now?: () => number;
}

const READING_LIST_URL = /^(https?|file):/;

export function createMockClient(options: MockOptions = {}): VivaldiClient {
  const { latencyMs = 0, pushDelayMs = 50, now = Date.now } = options;
  let strip = toStrip(options.snapshot ?? sampleSnapshot());
  let readingList = options.readingList ?? sampleReadingList();
  let subscribed = false;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const tabsListeners = new Set<(snapshot: TabsSnapshot) => void>();
  const readingListListeners = new Set<(entries: ReadingListEntry[]) => void>();

  const pushTabs = () => {
    if (!subscribed) return;
    const snapshot = fromStrip(strip);
    for (const listener of tabsListeners) listener(snapshot);
  };
  const pushReadingList = () => {
    if (!subscribed) return;
    for (const listener of readingListListeners) listener([...readingList]);
  };
  const scheduleTabsPush = () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushTabs, pushDelayMs);
  };

  /** Runs one request: waits the latency, turns thrown errors into `ModError`. */
  async function act<T>(fn: () => T): Promise<T> {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    try {
      return fn();
    } catch (e) {
      throw e instanceof ModError ? e : new ModError(e instanceof Error ? e.message : String(e));
    }
  }

  function setTabs(tabs: StripTab[], changes: Partial<Strip> = {}) {
    strip = { ...strip, ...changes, tabs };
    scheduleTabsPush();
  }

  function findTab(tabId: number): StripTab {
    const found = strip.tabs.find((t) => t.tab.id === tabId);
    if (!found) throw new ModError(`Unknown tab ${tabId}`);
    return found;
  }

  function activate(tabs: StripTab[], tabId: number): Partial<Strip> & { tabs: StripTab[] } {
    const target = tabs.find((t) => t.tab.id === tabId)!;
    return {
      tabs: tabs.map((t) => ({ ...t, tab: { ...t.tab, active: t.tab.id === tabId } })),
      activeTabId: tabId,
      activeWorkspaceId: target.workspaceId,
    };
  }

  /** A new tab at the end of the active workspace; not yet active. */
  function openTab(url: string, title: string): { tabs: StripTab[]; opened: StripTab } {
    const id = Math.max(0, ...strip.tabs.map((t) => t.tab.id)) + 1;
    const tab: Tab = {
      id,
      title,
      url,
      favIconUrl: "",
      audible: false,
      muted: false,
      pinned: false,
      active: false,
      discarded: false,
    };
    const opened = { tab, workspaceId: strip.activeWorkspaceId, stackId: null };
    const last = strip.tabs.findLastIndex((t) => t.workspaceId === strip.activeWorkspaceId);
    const at = last === -1 ? strip.tabs.length : last + 1;
    return { tabs: [...strip.tabs.slice(0, at), opened, ...strip.tabs.slice(at)], opened };
  }

  function setStackMeta(stackId: string, change: Partial<StackMeta>) {
    if (!strip.tabs.some((t) => t.stackId === stackId)) throw new ModError(`Unknown stack ${stackId}`);
    const stacks = new Map(strip.stacks);
    const meta = stacks.get(stackId) ?? { name: "", customName: false, color: null };
    stacks.set(stackId, { ...meta, ...change });
    setTabs(strip.tabs, { stacks });
  }

  function findEntry(url: string): ReadingListEntry {
    const entry = readingList.find((e) => e.url === url);
    if (!entry) throw new ModError(`Not in the reading list: ${url}`);
    return entry;
  }

  function setReadingList(entries: ReadingListEntry[]) {
    readingList = entries;
    pushReadingList();
  }

  return {
    windowId: strip.windowId,

    ping: () => act(() => ({ modVersion: "mock", vivaldiVersion: "mock" })),

    subscribe: () =>
      act(() => {
        subscribed = true;
        setTimeout(() => {
          pushTabs();
          pushReadingList();
        }, 0);
      }),

    getTabs: () => act(() => fromStrip(strip)),

    activateTab: (tabId) =>
      act(() => {
        findTab(tabId);
        const { tabs, ...changes } = activate(strip.tabs, tabId);
        setTabs(tabs, changes);
      }),

    closeTabs: (tabIds) =>
      act(() => {
        const closing = new Set(tabIds);
        const index = strip.tabs.findIndex((t) => t.tab.id === strip.activeTabId);
        let tabs = strip.tabs.filter((t) => !closing.has(t.tab.id));
        if (!closing.has(strip.activeTabId)) return setTabs(tabs);
        // Like a browser: activate the next tab in the same workspace, else the previous one.
        const ws = strip.activeWorkspaceId;
        const after = strip.tabs.slice(index + 1).find((t) => t.workspaceId === ws && !closing.has(t.tab.id));
        const before = strip.tabs.slice(0, index).findLast((t) => t.workspaceId === ws && !closing.has(t.tab.id));
        let next = after ?? before ?? tabs[0];
        if (!next) {
          // The window's last tab closed; Vivaldi would keep the window with a start page.
          strip = { ...strip, tabs };
          ({ tabs, opened: next } = openTab("vivaldi://startpage/", "Start Page"));
        }
        const { tabs: activated, ...changes } = activate(tabs, next.tab.id);
        setTabs(activated, changes);
      }),

    moveTabs: (args) => act(() => setTabs(applyMove(strip, args).tabs)),

    createStack: (tabIds) =>
      act(() => {
        const ids = new Set(tabIds);
        const members = strip.tabs.filter((t) => ids.has(t.tab.id));
        if (members.length !== ids.size) throw new ModError("Unknown tab");
        if (new Set(members.map((t) => t.tab.pinned)).size > 1) {
          throw new ModError("Can't stack pinned and unpinned tabs together");
        }
        const stackId = crypto.randomUUID();
        const first = strip.tabs.indexOf(members[0]!);
        const { workspaceId } = members[0]!;
        const stacked = members.map((t) => ({ ...t, workspaceId, stackId }));
        const rest = strip.tabs.filter((t) => !ids.has(t.tab.id));
        const at = rest.findIndex((t) => strip.tabs.indexOf(t) > first);
        const insertAt = at === -1 ? rest.length : at;
        setTabs([...rest.slice(0, insertAt), ...stacked, ...rest.slice(insertAt)]);
        return stackId;
      }),

    removeFromStack: (tabIds) =>
      act(() => {
        let next = strip;
        // In reverse, so tabs leaving the same stack keep their order after it.
        for (const tabId of [...tabIds].reverse()) {
          const { stackId } = next.tabs.find((t) => t.tab.id === tabId) ?? findTab(tabId);
          if (stackId === null) continue;
          const others = next.tabs.some((t) => t.stackId === stackId && t.tab.id !== tabId);
          next = others
            ? applyMove(next, { tabIds: [tabId], target: { stackId }, position: "after" })
            : { ...next, tabs: next.tabs.map((t) => (t.tab.id === tabId ? { ...t, stackId: null } : t)) };
        }
        setTabs(next.tabs);
      }),

    dissolveStack: (stackId) =>
      act(() => {
        if (!strip.tabs.some((t) => t.stackId === stackId)) throw new ModError(`Unknown stack ${stackId}`);
        setTabs(strip.tabs.map((t) => (t.stackId === stackId ? { ...t, stackId: null } : t)));
      }),

    renameStack: (stackId, name) => act(() => setStackMeta(stackId, { name, customName: name !== "" })),

    setStackColor: (stackId, color) => act(() => setStackMeta(stackId, { color })),

    addToReadingList: (items) =>
      act(() => {
        const added: string[] = [];
        const skipped: { url: string; reason: string }[] = [];
        let entries = readingList;
        for (const { url, title } of items) {
          if (!READING_LIST_URL.test(url)) {
            skipped.push({ url, reason: "Only http, https and file URLs can be added" });
            continue;
          }
          // Adding a URL that's already there doesn't make a second entry.
          entries = [
            ...entries.filter((e) => e.url !== url),
            { url, title, read: false, lastUpdate: now() },
          ];
          added.push(url);
        }
        if (added.length > 0) setReadingList(entries);
        return { added, skipped };
      }),

    getReadingList: () => act(() => [...readingList]),

    setRead: (url, read) =>
      act(() => {
        findEntry(url);
        setReadingList(readingList.map((e) => (e.url === url ? { ...e, read, lastUpdate: now() } : e)));
      }),

    removeFromReadingList: (url) =>
      act(() => {
        findEntry(url);
        setReadingList(readingList.filter((e) => e.url !== url));
      }),

    openReadingListItem: (url) =>
      act(() => {
        const entry = findEntry(url);
        const existing = strip.tabs.find((t) => t.tab.url === url);
        const { tabs, opened } = existing ? { tabs: strip.tabs, opened: existing } : openTab(url, entry.title);
        const { tabs: activated, ...changes } = activate(tabs, opened.tab.id);
        setTabs(activated, changes);
        setReadingList(readingList.map((e) => (e.url === url ? { ...e, read: true, lastUpdate: now() } : e)));
      }),

    onTabs: (listener) => {
      tabsListeners.add(listener);
      return () => tabsListeners.delete(listener);
    },

    onReadingList: (listener) => {
      readingListListeners.add(listener);
      return () => readingListListeners.delete(listener);
    },

    dispose: () => {
      clearTimeout(pushTimer);
      tabsListeners.clear();
      readingListListeners.clear();
    },
  };
}
