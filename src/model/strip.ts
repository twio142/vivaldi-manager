import type {
  MoveTabsArgs,
  Stack,
  StackColor,
  Tab,
  TabsSnapshot,
  Workspace,
  WorkspaceItem,
} from "../protocol/types";

// A flat view of a window's tab strip, close to how Vivaldi stores it: every tab carries its
// workspace and stack id. Easier to edit than the nested snapshot; convert back with `fromStrip`.

export interface StripTab {
  tab: Tab;
  workspaceId: number;
  stackId: string | null;
}

export interface StackMeta {
  /** Only meaningful when `customName` is true. */
  name: string;
  customName: boolean;
  color: StackColor | null;
}

export type WorkspaceMeta = Omit<Workspace, "items" | "tabCount">;

export interface Strip {
  windowId: number;
  activeTabId: number;
  activeWorkspaceId: number;
  workspaces: WorkspaceMeta[];
  /** Tab strip order. Only the order among tabs of the same workspace matters. */
  tabs: StripTab[];
  stacks: ReadonlyMap<string, StackMeta>;
}

export function toStrip(snapshot: TabsSnapshot): Strip {
  const tabs: StripTab[] = [];
  const stacks = new Map<string, StackMeta>();
  for (const ws of snapshot.workspaces) {
    for (const item of ws.items) {
      if (item.type === "stack") {
        stacks.set(item.id, {
          name: item.customName ? item.name : "",
          customName: item.customName,
          color: item.color,
        });
        for (const tab of item.tabs) tabs.push({ tab, workspaceId: ws.id, stackId: item.id });
      } else {
        const { type: _, ...tab } = item;
        tabs.push({ tab, workspaceId: ws.id, stackId: null });
      }
    }
  }
  return {
    windowId: snapshot.windowId,
    activeTabId: snapshot.activeTabId,
    activeWorkspaceId: snapshot.activeWorkspaceId,
    workspaces: snapshot.workspaces.map(({ items: _, tabCount: __, ...meta }) => meta),
    tabs,
    stacks,
  };
}

export function fromStrip(strip: Strip): TabsSnapshot {
  return {
    windowId: strip.windowId,
    activeTabId: strip.activeTabId,
    activeWorkspaceId: strip.activeWorkspaceId,
    workspaces: strip.workspaces.map((meta) => {
      const tabs = strip.tabs.filter((t) => t.workspaceId === meta.id);
      return { ...meta, tabCount: tabs.length, items: groupItems(tabs, strip.stacks) };
    }),
  };
}

/** Contiguous tabs sharing a stack id form a stack; a group of one is shown as a plain tab. */
function groupItems(tabs: StripTab[], stacks: ReadonlyMap<string, StackMeta>): WorkspaceItem[] {
  const items: WorkspaceItem[] = [];
  for (let i = 0; i < tabs.length; ) {
    const { stackId } = tabs[i]!;
    let j = i + 1;
    if (stackId !== null) while (j < tabs.length && tabs[j]!.stackId === stackId) j++;
    const run = tabs.slice(i, j).map((t) => t.tab);
    items.push(run.length > 1 ? makeStack(stackId!, run, stacks.get(stackId!)) : { type: "tab", ...run[0]! });
    i = j;
  }
  return items;
}

function makeStack(id: string, tabs: Tab[], meta: StackMeta | undefined): Stack {
  const customName = meta?.customName ?? false;
  // Vivaldi shows the most recently active tab's title; the active tab is the best guess we have.
  const shown = tabs.find((t) => t.active) ?? tabs[0]!;
  return {
    type: "stack",
    id,
    name: customName ? meta!.name : shown.title,
    customName,
    color: meta?.color ?? null,
    tabs,
  };
}

/** Index range [first, last] of the run of tabs around `index` that share its stack id. */
function runBounds(tabs: StripTab[], index: number): [number, number] {
  const { stackId } = tabs[index]!;
  let first = index;
  let last = index;
  if (stackId === null) return [first, last];
  while (first > 0 && tabs[first - 1]!.stackId === stackId) first--;
  while (last < tabs.length - 1 && tabs[last + 1]!.stackId === stackId) last++;
  return [first, last];
}

/** What `moveTabs` does, per VIVALDI.md *Moving*. Throws on an unknown target. */
export function applyMove(strip: Strip, args: MoveTabsArgs): Strip {
  const movedStacks = new Set(args.stackIds ?? []);
  const ids = new Set(args.tabIds ?? []);
  for (const t of strip.tabs) if (t.stackId !== null && movedStacks.has(t.stackId)) ids.add(t.tab.id);

  const moving = strip.tabs.filter((t) => ids.has(t.tab.id));
  if (moving.length === 0) throw new Error("Nothing to move");
  const rest = strip.tabs.filter((t) => !ids.has(t.tab.id));
  const before = args.position === "before";
  const { target } = args;

  let insertAt: number;
  let workspaceId: number;
  let joinStack: string | null = null;

  if ("workspaceId" in target) {
    workspaceId = target.workspaceId;
    if (!strip.workspaces.some((w) => w.id === workspaceId)) {
      throw new Error(`Unknown workspace ${workspaceId}`);
    }
    const last = rest.findLastIndex((t) => t.workspaceId === workspaceId);
    insertAt = last === -1 ? rest.length : last + 1;
  } else {
    const index =
      "tabId" in target
        ? rest.findIndex((t) => t.tab.id === target.tabId)
        : rest.findIndex((t) => t.stackId === target.stackId);
    if (index === -1) {
      throw new Error("tabId" in target ? `Unknown tab ${target.tabId}` : `Unknown stack ${target.stackId}`);
    }
    const anchor = rest[index]!;
    workspaceId = anchor.workspaceId;
    if ("tabId" in target && args.intoStack && anchor.stackId !== null) {
      joinStack = anchor.stackId;
      insertAt = before ? index : index + 1;
    } else {
      // Outside a stack, a stacked target stands for the whole stack.
      const [first, last] = runBounds(rest, index);
      insertAt = before ? first : last + 1;
    }
  }

  const placed = moving.map((t) => ({
    ...t,
    workspaceId,
    stackId: joinStack ?? (t.stackId !== null && movedStacks.has(t.stackId) ? t.stackId : null),
  }));
  return { ...strip, tabs: [...rest.slice(0, insertAt), ...placed, ...rest.slice(insertAt)] };
}
