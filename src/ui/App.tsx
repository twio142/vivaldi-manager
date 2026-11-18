import { useEffect, useRef, useState } from "preact/hooks";
import { applyMove, fromStrip, toStrip } from "../model/strip";
import { ModNotInstalledError, type VivaldiClient } from "../protocol/client";
import type { ReadingListEntry, TabsSnapshot } from "../protocol/types";
import {
  DEFAULT_PREFS,
  SORT_ORDERS,
  handleReadingListKey,
  initialReadingListState,
  reconcileReadingList,
  setReadingListQuery,
  visibleEntries,
  type ReadingListEffect,
  type ReadingListPrefs,
  type ReadingListViewState,
} from "../state/readingListView";
import { buildRows, stackKey, type Row } from "../state/rows";
import { searchRows } from "../state/search";
import {
  focusWhenPresent,
  handleKey,
  initialState,
  reconcile,
  setDraft,
  setQuery,
  type Effect,
  type TabsViewState,
} from "../state/tabsView";
import { keyName } from "./keys";
import { ReadingList } from "./ReadingList";
import { SearchInput } from "./SearchInput";
import { TabsList } from "./TabsList";

type Status = { kind: "connecting" } | { kind: "ready" } | { kind: "not-installed" } | { kind: "error"; message: string };
type View = "tabs" | "readingList";

interface TabsModel {
  snapshot: TabsSnapshot;
  rows: Row[];
  view: TabsViewState;
}

interface ReadingListModel {
  /** The whole list, unsorted; the view picks what to show. */
  entries: ReadingListEntry[];
  view: ReadingListViewState;
}

/** The tab rows on screen: all of them, or the search results. */
const shownRows = (rows: Row[], view: TabsViewState) => (view.mode === "search" ? searchRows(rows, view.query).rows : rows);

// Sort order and hide-read are kept across popup openings. Outside the extension (the mock in a
// normal tab) there's no chrome.storage, and they just reset.
const PREFS_KEY = "readingListPrefs";
const storage = () => (typeof chrome !== "undefined" ? chrome.storage?.local : undefined);

async function loadPrefs(): Promise<ReadingListPrefs> {
  try {
    const stored = (await storage()?.get(PREFS_KEY))?.[PREFS_KEY] as Partial<ReadingListPrefs> | undefined;
    return {
      sort: stored?.sort && SORT_ORDERS.includes(stored.sort) ? stored.sort : DEFAULT_PREFS.sort,
      hideRead: typeof stored?.hideRead === "boolean" ? stored.hideRead : DEFAULT_PREFS.hideRead,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface Toast {
  id: number;
  text: string;
  error: boolean;
}

function TabsView({
  model,
  onQuery,
  onDraft,
}: {
  model: TabsModel;
  onQuery: (query: string) => void;
  onDraft: (draft: string) => void;
}) {
  const { view } = model;
  const search = view.mode === "search" ? searchRows(model.rows, view.query) : null;
  return (
    <>
      {search && <SearchInput value={view.query} active onInput={onQuery} />}
      {search && search.rows.length === 0 ? (
        <p class="notice">No matches.</p>
      ) : (
        <TabsList rows={search?.rows ?? model.rows} matches={search?.matches} view={view} onDraft={onDraft} />
      )}
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App({ connect }: { connect: () => Promise<VivaldiClient> }) {
  const [status, setStatus] = useState<Status>({ kind: "connecting" });
  const [view, setView] = useState<View>("tabs");
  const [tabs, setTabsState] = useState<TabsModel | null>(null);
  const [readingList, setReadingListState] = useState<ReadingListModel | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Key presses can arrive faster than renders, so handlers read and write these refs, which are
  // always current, and mirror every write into state for rendering.
  const client = useRef<VivaldiClient | null>(null);
  const tabsRef = useRef<TabsModel | null>(null);
  const readingListRef = useRef<ReadingListModel | null>(null);
  const viewRef = useRef<View>("tabs");
  const statusRef = useRef<Status>(status);
  // Effects run one at a time, in order, so successive moves reach the mod in the order pressed.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const toastId = useRef(0);
  const prefs = useRef<ReadingListPrefs>(DEFAULT_PREFS);

  const setTabs = (next: TabsModel) => {
    tabsRef.current = next;
    setTabsState(next);
  };
  const setReadingList = (next: ReadingListModel) => {
    readingListRef.current = next;
    setReadingListState(next);
  };
  const setStatusBoth = (next: Status) => {
    statusRef.current = next;
    setStatus(next);
  };
  const switchView = (next: View) => {
    viewRef.current = next;
    setView(next);
  };

  const toast = (text: string, error = false) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 5000 : 2500);
  };

  const applySnapshot = (snapshot: TabsSnapshot) => {
    const rows = buildRows(snapshot);
    const prev = tabsRef.current;
    // Reconciled against what's on screen, so during a search focus stays on a result.
    const view = prev
      ? reconcile(prev.view, shownRows(prev.rows, prev.view), shownRows(rows, prev.view))
      : initialState(rows, snapshot.activeTabId);
    setTabs({ snapshot, rows, view });
  };

  const applyEntries = (entries: ReadingListEntry[]) => {
    const prev = readingListRef.current;
    const state = prev?.view ?? initialReadingListState(prefs.current);
    const before = prev ? visibleEntries(prev.entries, state).entries : [];
    setReadingList({ entries, view: reconcileReadingList(state, before, visibleEntries(entries, state).entries) });
  };

  async function run(effect: Effect | ReadingListEffect) {
    const c = client.current;
    if (!c) return;
    try {
      switch (effect.type) {
        case "activate":
          return await c.activateTab(effect.tabId);
        case "close":
          return await c.closeTabs(effect.tabIds);
        case "move": {
          // Reorder locally right away; the next push brings the real result.
          const current = tabsRef.current;
          if (current) applySnapshot(fromStrip(applyMove(toStrip(current.snapshot), effect.args)));
          return await c.moveTabs(effect.args);
        }
        case "copy":
          await navigator.clipboard.writeText(effect.urls.join("\n"));
          return toast(`Copied ${plural(effect.urls.length, "URL")}`);
        case "addToReadingList": {
          const { added, skipped } = await c.addToReadingList(effect.items);
          if (added.length > 0) toast(`Added ${plural(added.length, "page")} to the reading list`);
          if (skipped.length > 0) {
            // Name each skipped page, with the mod's reason; a long list is cut off.
            const title = (url: string) => effect.items.find((i) => i.url === url)?.title || url;
            const lines = skipped.slice(0, 3).map((s) => `${title(s.url)}: ${s.reason}`);
            if (skipped.length > 3) lines.push(`and ${skipped.length - 3} more`);
            toast(`Skipped ${plural(skipped.length, "page")}:\n${lines.join("\n")}`, true);
          }
          return;
        }
        case "createStack": {
          const stackId = await c.createStack(effect.tabIds);
          const model = tabsRef.current;
          if (model) setTabs({ ...model, view: focusWhenPresent(model.view, model.rows, stackKey(stackId)) });
          return;
        }
        case "renameStack":
          return await c.renameStack(effect.stackId, effect.name);
        case "setStackColor":
          return await c.setStackColor(effect.stackId, effect.color);
        case "removeFromStack":
          return await c.removeFromStack(effect.tabIds);
        case "dissolveStack":
          return await c.dissolveStack(effect.stackId);
        case "open":
          return await c.openReadingListItem(effect.url);
        case "remove":
          return await c.removeFromReadingList(effect.url);
        case "setRead":
          return await c.setRead(effect.url, effect.read);
        case "savePrefs":
          prefs.current = effect.prefs;
          return await storage()?.set({ [PREFS_KEY]: effect.prefs });
        case "closePopup":
          return window.close();
      }
    } catch (e) {
      if (e instanceof ModNotInstalledError) return setStatusBoth({ kind: "not-installed" });
      toast(errorText(e), true);
      // A refused move leaves the optimistic reorder on screen; fetch the real order back.
      if (effect.type === "move") c.getTabs().then(applySnapshot, () => {});
    }
  }

  const enqueue = (effects: (Effect | ReadingListEffect)[]) => {
    for (const effect of effects) queue.current = queue.current.then(() => run(effect));
  };

  useEffect(() => {
    let c: VivaldiClient | undefined;
    (async () => {
      // Before subscribing, so the first reading list push is shown in the saved order.
      prefs.current = await loadPrefs();
      c = await connect();
      client.current = c;
      c.onTabs(applySnapshot);
      c.onReadingList(applyEntries);
      await c.subscribe();
      setStatusBoth({ kind: "ready" });
    })().catch((e: unknown) => {
      if (e instanceof ModNotInstalledError) setStatusBoth({ kind: "not-installed" });
      else setStatusBoth({ kind: "error", message: errorText(e) });
    });
    return () => c?.dispose();
  }, []);

  /** Runs a key through the tabs view. Returns whether it was handled. */
  const tabsKey = (key: string): boolean => {
    const model = tabsRef.current;
    if (!model) return false;
    const result = handleKey(model.view, shownRows(model.rows, model.view), key);
    if (!result.handled) return false;
    if (result.state !== model.view) setTabs({ ...model, view: result.state });
    enqueue(result.effects);
    return true;
  };

  /** Runs a key through the reading list view; the sort and hide-read buttons use it too. */
  const readingListKey = (key: string): boolean => {
    const model = readingListRef.current;
    if (!model) return false;
    const result = handleReadingListKey(model.view, model.entries, key);
    if (!result.handled) return false;
    if (result.state !== model.view) setReadingList({ ...model, view: result.state });
    enqueue(result.effects);
    return true;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = keyName(e);
      if (key === null) return;
      if (key === "ctrl-n") {
        e.preventDefault();
        return switchView(viewRef.current === "tabs" ? "readingList" : "tabs");
      }
      if (statusRef.current.kind !== "ready") {
        if (key === "Escape") window.close();
        return;
      }
      if (viewRef.current === "tabs" ? tabsKey(key) : readingListKey(key)) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div class="popup">
      <nav class="views">
        {(["tabs", "readingList"] as const).map((v) => (
          // Never takes focus, so Enter and Tab keep going to the list.
          <button
            key={v}
            tabIndex={-1}
            class={view === v ? "current" : ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => switchView(v)}
          >
            {v === "tabs" ? "Tabs" : "Reading list"}
          </button>
        ))}
        {tabs && tabs.view.mode !== "normal" && view === "tabs" && (
          <span class="mode">{tabs.view.mode.toUpperCase()}</span>
        )}
      </nav>
      <main>
        {status.kind === "connecting" && <p class="notice">Connecting…</p>}
        {status.kind === "not-installed" && (
          <p class="notice">
            Vivaldi mod not installed. Install the Vivaldi Manager mod, then restart Vivaldi with Cmd+Q.
          </p>
        )}
        {status.kind === "error" && <p class="notice error">{status.message}</p>}
        {status.kind === "ready" && view === "tabs" && tabs && (
          <TabsView
            model={tabs}
            onQuery={(query) => {
              const model = tabsRef.current;
              if (model) setTabs({ ...model, view: setQuery(model.view, query, searchRows(model.rows, query)) });
            }}
            onDraft={(draft) => {
              const model = tabsRef.current;
              if (model) setTabs({ ...model, view: setDraft(model.view, draft) });
            }}
          />
        )}
        {status.kind === "ready" && view === "readingList" && readingList && (
          <ReadingList
            entries={readingList.entries}
            view={readingList.view}
            onQuery={(query) => {
              const model = readingListRef.current;
              if (model) setReadingList({ ...model, view: setReadingListQuery(model.view, model.entries, query) });
            }}
            onKey={readingListKey}
          />
        )}
      </main>
      <ul class="toasts">
        {toasts.map((t) => (
          <li key={t.id} class={t.error ? "toast error" : "toast"}>
            {t.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
