import type { MoveTabsArgs, MoveTarget, Workspace, WorkspaceItem } from "../protocol/types";
import type { Row } from "./rows";

// Move mode: which `moveTabs` call one `j`/`k` (or `J`/`K`) press makes. Each press moves the
// focused row one visual step:
//
// - into a stack when passing its edge (`J`/`K` jump over it instead),
// - out of its stack when at the stack's first or last tab,
// - into the neighbouring workspace when at the edge of its own (an empty one included).
//
// Returns null when there's nowhere to go (top or bottom of the list). Moves don't wrap.

const itemTarget = (item: WorkspaceItem): MoveTarget =>
  item.type === "stack" ? { stackId: item.id } : { tabId: item.id };

/** Entering `workspace` from above (`dir` 1) lands at its top; from below, at its bottom. */
function workspaceEdge(workspace: Workspace, dir: 1 | -1): Omit<MoveTabsArgs, "tabIds" | "stackIds"> {
  const item = dir === 1 ? workspace.items[0] : workspace.items.at(-1);
  if (!item) return { target: { workspaceId: workspace.id }, position: "after", intoStack: false };
  return { target: itemTarget(item), position: dir === 1 ? "before" : "after", intoStack: false };
}

export function computeMove(rows: Row[], key: string, dir: 1 | -1, over = false): MoveTabsArgs | null {
  const start = rows.findIndex((r) => r.key === key);
  const row = rows[start];
  if (!row || row.kind === "workspace") return null;

  const end = row.kind === "stack" ? start + row.stack.tabs.length : start;
  const moving = row.kind === "stack" ? { stackIds: [row.stack.id] } : { tabIds: [row.tab.id] };
  const neighbor = rows[dir === 1 ? end + 1 : start - 1];
  if (!neighbor) return null;
  const position = dir === 1 ? "after" : "before";

  // A tab inside a stack reorders within it, or steps out past the stack's edge.
  if (row.kind === "tab" && row.stackId !== null) {
    if (neighbor.kind === "tab" && neighbor.stackId === row.stackId) {
      return { ...moving, target: { tabId: neighbor.tab.id }, position, intoStack: true };
    }
    return { ...moving, target: { stackId: row.stackId }, position, intoStack: false };
  }

  if (neighbor.kind === "workspace") {
    // Going down, the neighbour is the next workspace. Going up, it's our own: look one further.
    const workspace =
      dir === 1
        ? neighbor.workspace
        : rows.slice(0, start - 1).findLast((r) => r.kind === "workspace")?.workspace;
    return workspace ? { ...moving, ...workspaceEdge(workspace, dir) } : null;
  }

  // Stacks can't nest, so a whole stack always jumps over another one.
  const jumpOver = row.kind === "stack" || over;

  // Going down onto a stack's row: join at its top.
  if (neighbor.kind === "stack") {
    return jumpOver
      ? { ...moving, target: { stackId: neighbor.stack.id }, position: "after", intoStack: false }
      : { ...moving, target: { tabId: neighbor.stack.tabs[0]!.id }, position: "before", intoStack: true };
  }

  // Going up onto a stack's last tab: join at its bottom.
  if (neighbor.stackId !== null) {
    return jumpOver
      ? { ...moving, target: { stackId: neighbor.stackId }, position: "before", intoStack: false }
      : { ...moving, target: { tabId: neighbor.tab.id }, position: "after", intoStack: true };
  }

  return { ...moving, target: { tabId: neighbor.tab.id }, position, intoStack: false };
}
