import type { Stack, Tab, TabsSnapshot, Workspace } from "../protocol/types";

// The tabs view as a flat list of rows, in display order. Focus and selection refer to rows by key,
// so they survive a new snapshot.

export type WorkspaceRow = { kind: "workspace"; key: string; workspace: Workspace };
export type StackRow = { kind: "stack"; key: string; workspaceId: number; stack: Stack };
export type TabRow = { kind: "tab"; key: string; workspaceId: number; stackId: string | null; tab: Tab };
export type Row = WorkspaceRow | StackRow | TabRow;

export const tabKey = (tabId: number) => `tab:${tabId}`;
export const stackKey = (stackId: string) => `stack:${stackId}`;
export const workspaceKey = (workspaceId: number) => `ws:${workspaceId}`;

export function buildRows(snapshot: TabsSnapshot): Row[] {
  const rows: Row[] = [];
  for (const workspace of snapshot.workspaces) {
    rows.push({ kind: "workspace", key: workspaceKey(workspace.id), workspace });
    for (const item of workspace.items) {
      if (item.type === "stack") {
        rows.push({ kind: "stack", key: stackKey(item.id), workspaceId: workspace.id, stack: item });
        for (const tab of item.tabs) {
          rows.push({ kind: "tab", key: tabKey(tab.id), workspaceId: workspace.id, stackId: item.id, tab });
        }
      } else {
        const { type: _, ...tab } = item;
        rows.push({ kind: "tab", key: tabKey(tab.id), workspaceId: workspace.id, stackId: null, tab });
      }
    }
  }
  return rows;
}

export const isFocusable = (row: Row) => row.kind !== "workspace";

/** The tabs a row stands for: itself, a stack's tabs, or a workspace's tabs. */
export function rowTabs(row: Row): Tab[] {
  switch (row.kind) {
    case "tab":
      return [row.tab];
    case "stack":
      return row.stack.tabs;
    case "workspace":
      return row.workspace.items.flatMap((item) => (item.type === "stack" ? item.tabs : [item]));
  }
}

/**
 * The next focusable row in direction `dir`, wrapping around. With `skipStacked`, tabs inside
 * stacks are passed over (`J`/`K`). Returns `key` itself if nothing else qualifies.
 */
export function stepFocus(rows: Row[], key: string | null, dir: 1 | -1, skipStacked = false): string | null {
  const qualifies = (row: Row) => isFocusable(row) && !(skipStacked && row.kind === "tab" && row.stackId !== null);
  const start = rows.findIndex((r) => r.key === key);
  if (start === -1) return (dir === 1 ? rows.find(qualifies) : rows.findLast(qualifies))?.key ?? null;
  for (let step = 1; step < rows.length; step++) {
    const row = rows[(start + dir * step + rows.length) % rows.length]!;
    if (qualifies(row)) return row.key;
  }
  return key;
}
