import type { MoveTabsArgs, Workspace } from "../protocol/types";
import { stackKey, tabKey, type Row } from "./rows";

// Drag and drop: where a dragged row (a tab, or a whole stack) lands when dropped on the top or
// bottom half of another row. Like move mode, it moves only that row, never the selection.
//
// - Loose tab: before or after it.
// - Tab inside a stack: before or after it, joining the stack (a stack is dropped after the whole
//   target stack instead, since stacks can't nest).
// - Stack row: top half goes before the stack. Bottom half joins it at the top (a tab), or goes
//   after the whole stack (a stack).
// - Workspace row: the top of that workspace, or into it when it's empty.

export type Half = "top" | "bottom";

export interface Drop {
  args: MoveTabsArgs;
  /** Where to draw the drop line: the edge of this row. */
  indicator: { key: string; edge: Half };
}

function workspaceTop(workspace: Workspace): Omit<MoveTabsArgs, "tabIds" | "stackIds"> {
  const first = workspace.items[0];
  if (!first) return { target: { workspaceId: workspace.id }, position: "after", intoStack: false };
  const target = first.type === "stack" ? { stackId: first.id } : { tabId: first.id };
  return { target, position: "before", intoStack: false };
}

export function computeDrop(rows: Row[], dragKey: string, overKey: string, half: Half): Drop | null {
  const dragged = rows.find((r) => r.key === dragKey);
  const over = rows.find((r) => r.key === overKey);
  if (!dragged || !over || dragged.kind === "workspace") return null;
  // Onto itself, or a stack onto its own tabs.
  if (over.key === dragged.key) return null;
  if (dragged.kind === "stack" && over.kind === "tab" && over.stackId === dragged.stack.id) return null;

  const moving = dragged.kind === "stack" ? { stackIds: [dragged.stack.id] } : { tabIds: [dragged.tab.id] };
  const position = half === "top" ? "before" : "after";
  const at = (key: string, edge: Half) => ({ key, edge });

  switch (over.kind) {
    case "workspace":
      return { args: { ...moving, ...workspaceTop(over.workspace) }, indicator: at(over.key, "bottom") };

    case "stack":
      if (half === "top") {
        return {
          args: { ...moving, target: { stackId: over.stack.id }, position: "before", intoStack: false },
          indicator: at(over.key, "top"),
        };
      }
      if (dragged.kind === "stack") {
        const last = over.stack.tabs.at(-1)!;
        return {
          args: { ...moving, target: { stackId: over.stack.id }, position: "after", intoStack: false },
          indicator: at(tabKey(last.id), "bottom"),
        };
      }
      return {
        args: { ...moving, target: { tabId: over.stack.tabs[0]!.id }, position: "before", intoStack: true },
        indicator: at(over.key, "bottom"),
      };

    case "tab":
      if (over.stackId === null) {
        return {
          args: { ...moving, target: { tabId: over.tab.id }, position, intoStack: false },
          indicator: at(over.key, half),
        };
      }
      if (dragged.kind === "stack") {
        const stack = rows.find((r) => r.key === stackKey(over.stackId!));
        const last = stack?.kind === "stack" ? stack.stack.tabs.at(-1)! : over.tab;
        return {
          args: { ...moving, target: { stackId: over.stackId }, position: "after", intoStack: false },
          indicator: at(tabKey(last.id), "bottom"),
        };
      }
      return {
        args: { ...moving, target: { tabId: over.tab.id }, position, intoStack: true },
        indicator: at(over.key, half),
      };
  }
}
