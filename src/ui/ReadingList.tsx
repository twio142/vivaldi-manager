import { useEffect, useRef } from "preact/hooks";
import type { ReadingListEntry } from "../protocol/types";
import type { ReadingListViewState } from "../state/readingListView";
import { Favicon } from "./Favicon";

function domain(url: string): string {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "file:" ? "file" : hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function EntryItem({ entry, focused }: { entry: ReadingListEntry; focused: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const classes = ["row", "entry", entry.read && "read", focused && "focused"].filter(Boolean);
  return (
    <li ref={ref} class={classes.join(" ")} aria-selected={focused}>
      <Favicon pageUrl={entry.url} />
      <span class="title">{entry.title || entry.url}</span>
      <span class="domain">{domain(entry.url)}</span>
      <span class="read-state" title={entry.read ? "Read" : "Unread"}>
        {entry.read ? "" : "●"}
      </span>
    </li>
  );
}

export function ReadingList({ entries, view }: { entries: ReadingListEntry[]; view: ReadingListViewState }) {
  if (entries.length === 0) return <p class="notice">The reading list is empty.</p>;
  return (
    <ul class="rows" role="listbox">
      {entries.map((entry) => (
        <EntryItem key={entry.url} entry={entry} focused={entry.url === view.focus} />
      ))}
    </ul>
  );
}
