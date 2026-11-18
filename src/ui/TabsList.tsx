import { useEffect, useRef } from "preact/hooks";
import { STACK_COLORS, type StackColor, type Tab, type WorkspaceIcon as Icon } from "../protocol/types";
import { tabKey, type Row } from "../state/rows";
import type { RowMatch } from "../state/search";
import type { TabsViewState } from "../state/tabsView";
import { Favicon } from "./Favicon";
import { Highlight } from "./Highlight";

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

function Dot({ color, chosen = false }: { color: StackColor | null; chosen?: boolean }) {
  const classes = ["dot", color === null && "none", chosen && "chosen"].filter(Boolean).join(" ");
  return (
    <span
      class={classes}
      style={color ? `background: ${STACK_COLORS[color].rgb}` : undefined}
      title={color ? STACK_COLORS[color].name : "No color"}
    />
  );
}

function RenameInput({ draft, onDraft }: { draft: string; onDraft: (draft: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      class="title rename"
      value={draft}
      spellcheck={false}
      onInput={(e) => onDraft(e.currentTarget.value)}
    />
  );
}

/** How the focused stack row is being edited, if it is. */
type Editing =
  | { mode: "rename"; draft: string; onDraft: (draft: string) => void }
  | { mode: "color"; colors: (StackColor | null)[]; index: number };

function RowContent({ row, editing, match }: { row: Row; editing?: Editing; match?: RowMatch }) {
  switch (row.kind) {
    case "workspace":
      return (
        <>
          <WorkspaceIcon icon={row.workspace.icon} />
          <span class="title">{row.workspace.name}</span>
          <span class="count">{row.workspace.tabCount}</span>
        </>
      );
    case "stack":
      return (
        <>
          <Dot color={row.stack.color} />
          {editing?.mode === "rename" ? (
            <RenameInput draft={editing.draft} onDraft={editing.onDraft} />
          ) : editing?.mode === "color" ? (
            // The color choices take the name's place.
            <span class="title colors">
              {editing.colors.map((color, i) => (
                <Dot key={color ?? "none"} color={color} chosen={i === editing.index} />
              ))}
            </span>
          ) : (
            <span class="title">
              <Highlight text={row.stack.name} positions={match?.positions} />
            </span>
          )}
          <span class="count">{row.stack.tabs.length}</span>
        </>
      );
    case "tab":
      return (
        <>
          <Favicon pageUrl={row.tab.url} iconUrl={row.tab.favIconUrl} />
          <span class="title">
            <Highlight text={row.tab.title || row.tab.url} positions={match?.field === "title" ? match.positions : undefined} />
          </span>
          {match?.field === "url" && (
            // Matched by URL: show it, since the title alone wouldn't explain the match.
            <span class="url">
              <Highlight text={row.tab.url} positions={match.positions} />
            </span>
          )}
          <AudioIcon tab={row.tab} />
        </>
      );
  }
}

function RowItem({
  row,
  focused,
  selected,
  moving,
  editing,
  match,
}: {
  row: Row;
  focused: boolean;
  selected: boolean;
  moving: boolean;
  editing?: Editing;
  match?: RowMatch;
}) {
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
      <RowContent row={row} editing={editing} match={match} />
    </li>
  );
}

export function TabsList({
  rows,
  matches,
  view,
  onDraft,
}: {
  rows: Row[];
  /** Search matches, for highlighting. */
  matches?: ReadonlyMap<string, RowMatch>;
  view: TabsViewState;
  onDraft: (draft: string) => void;
}) {
  // In move mode the focused row is marked; a stack is marked with all its tabs, which move with it.
  const focusedRow = rows.find((r) => r.key === view.focus);
  const moving = new Set<string>();
  if (view.mode === "move" && focusedRow) {
    moving.add(focusedRow.key);
    if (focusedRow.kind === "stack") for (const t of focusedRow.stack.tabs) moving.add(tabKey(t.id));
  }
  const editing: Editing | undefined =
    view.mode === "rename"
      ? { mode: "rename", draft: view.draft, onDraft }
      : view.mode === "color"
        ? { mode: "color", colors: view.colors, index: view.colorIndex }
        : undefined;
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
          editing={row.key === view.focus ? editing : undefined}
          match={matches?.get(row.key)}
        />
      ))}
    </ul>
  );
}
