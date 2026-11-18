import { useEffect, useRef } from "preact/hooks";
import type { ReadingListEntry } from "../protocol/types";
import {
  SORT_LABELS,
  visibleEntries,
  type EntryMatch,
  type ReadingListViewState,
} from "../state/readingListView";
import { Favicon } from "./Favicon";
import { Highlight } from "./Highlight";
import { SearchInput } from "./SearchInput";

function domain(url: string): string {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "file:" ? "file" : hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function EntryItem({ entry, focused, match }: { entry: ReadingListEntry; focused: boolean; match?: EntryMatch }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const classes = ["row", "entry", entry.read && "read", focused && "focused"].filter(Boolean);
  return (
    <li ref={ref} class={classes.join(" ")} aria-selected={focused}>
      <Favicon pageUrl={entry.url} />
      <span class="title">
        <Highlight text={entry.title || entry.url} positions={match?.field === "title" ? match.positions : undefined} />
      </span>
      {match?.field === "url" ? (
        <span class="url">
          <Highlight text={entry.url} positions={match.positions} />
        </span>
      ) : (
        <span class="domain">{domain(entry.url)}</span>
      )}
      <span class="read-state" title={entry.read ? "Read" : "Unread"}>
        {entry.read ? "" : "●"}
      </span>
    </li>
  );
}

/** A toolbar button that never takes focus, so keys keep going to the list. */
function ToolButton({ label, pressed, onClick }: { label: string; pressed?: boolean; onClick: () => void }) {
  return (
    <button
      tabIndex={-1}
      class={pressed ? "tool pressed" : "tool"}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function ReadingList({
  entries: all,
  view,
  onQuery,
  onKey,
}: {
  entries: ReadingListEntry[];
  view: ReadingListViewState;
  onQuery: (query: string) => void;
  /** Runs a key as if pressed; the toolbar buttons are shortcuts for `s`, `h` and `/`. */
  onKey: (key: string) => boolean;
}) {
  const { entries, matches } = visibleEntries(all, view);
  const searching = view.mode === "search";
  return (
    <>
      <div class="toolbar">
        <SearchInput
          value={view.query}
          active={searching}
          onInput={onQuery}
          onFocus={() => {
            if (!searching) onKey("/");
          }}
        />
        <ToolButton label={`Sort: ${SORT_LABELS[view.sort]}`} onClick={() => onKey("s")} />
        <ToolButton label="Hide read" pressed={view.hideRead} onClick={() => onKey("h")} />
      </div>
      {entries.length === 0 ? (
        <p class="notice">
          {searching && view.query.trim() !== ""
            ? "No matches."
            : all.length === 0
              ? "The reading list is empty."
              : "No unread pages."}
        </p>
      ) : (
        <ul class="rows" role="listbox">
          {entries.map((entry) => (
            <EntryItem key={entry.url} entry={entry} focused={entry.url === view.focus} match={matches.get(entry.url)} />
          ))}
        </ul>
      )}
    </>
  );
}
