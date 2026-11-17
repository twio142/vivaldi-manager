import { useEffect, useRef } from "preact/hooks";
import { STACK_COLORS, type Tab, type WorkspaceIcon as Icon } from "../protocol/types";
import { tabKey, type Row } from "../state/rows";
import type { TabsViewState } from "../state/tabsView";
import { Favicon } from "./Favicon";

function WorkspaceIcon({ icon }: { icon: Icon }) {
  if ("emoji" in icon) return <span class="ws-icon">{icon.emoji}</span>;
  // Vivaldi's SVG icons are monochrome; a mask lets them take the text color.
  const url = `url("data:image/svg+xml,${encodeURIComponent(icon.svg)}")`;
  return <span class="ws-icon svg" style={`mask-image: ${url}`} />;
}

function AudioIcon({ tab }: { tab: Tab }) {
  if (tab.muted) return <span class="audio" title="Muted">🔇</span>;
  if (tab.audible) return <span class="audio" title="Playing audio">🔊</span>;
  return null;
}

function RowContent({ row }: { row: Row }) {
  switch (row.kind) {
    case "workspace":
      return (
        <>
          <WorkspaceIcon icon={row.workspace.icon} />
          <span class="title">{row.workspace.name}</span>
          <span class="count">{row.workspace.tabCount}</span>
        </>
      );
    case "stack": {
      const color = row.stack.color ? STACK_COLORS[row.stack.color].rgb : undefined;
      return (
        <>
          <span class={color ? "dot" : "dot none"} style={color ? `background: ${color}` : undefined} />
          <span class="title">{row.stack.name}</span>
          <span class="count">{row.stack.tabs.length}</span>
        </>
      );
    }
    case "tab":
      return (
        <>
          <Favicon pageUrl={row.tab.url} iconUrl={row.tab.favIconUrl} />
          <span class="title">{row.tab.title || row.tab.url}</span>
          <AudioIcon tab={row.tab} />
        </>
      );
  }
}

function RowItem({ row, focused, selected, moving }: { row: Row; focused: boolean; selected: boolean; moving: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const classes = [
    "row",
    row.kind,
    row.kind === "tab" && row.stackId !== null && "stacked",
    row.kind === "tab" && row.tab.active && "active",
    row.kind === "tab" && row.tab.discarded && "discarded",
    row.kind === "workspace" && row.workspace.tabCount === 0 && "empty",
    focused && "focused",
    selected && "selected",
    moving && "moving",
  ].filter(Boolean);
  return (
    <li ref={ref} class={classes.join(" ")} aria-selected={focused}>
      <RowContent row={row} />
    </li>
  );
}

export function TabsList({ rows, view }: { rows: Row[]; view: TabsViewState }) {
  // In move mode the focused row is marked; a stack is marked with all its tabs, which move with it.
  const focusedRow = rows.find((r) => r.key === view.focus);
  const moving = new Set<string>();
  if (view.mode === "move" && focusedRow) {
    moving.add(focusedRow.key);
    if (focusedRow.kind === "stack") for (const t of focusedRow.stack.tabs) moving.add(tabKey(t.id));
  }
  const isSelected = (row: Row) =>
    row.kind === "tab"
      ? view.selection.has(row.tab.id)
      : row.kind === "stack" && row.stack.tabs.every((t) => view.selection.has(t.id));

  return (
    <ul class="rows" role="listbox">
      {rows.map((row) => (
        <RowItem
          key={row.key}
          row={row}
          focused={row.key === view.focus}
          selected={isSelected(row)}
          moving={moving.has(row.key)}
        />
      ))}
    </ul>
  );
}
