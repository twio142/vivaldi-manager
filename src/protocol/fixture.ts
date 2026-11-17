import type { ReadingListEntry, Tab, TabsSnapshot, WorkspaceItem } from "./types";

// Sample data for the mock backend and tests: every shape the snapshot can take.

const FOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M1 3h5l2 2h7v8H1z"/></svg>';
const BRIEFCASE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M5 2h6v2h4v10H1V4h4zm1 1v1h4V3z"/></svg>';

function tab(id: number, title: string, url: string, extra: Partial<Tab> = {}): Tab {
  return {
    id,
    title,
    url,
    favIconUrl: "",
    audible: false,
    muted: false,
    pinned: false,
    active: false,
    discarded: false,
    ...extra,
  };
}

const loose = (t: Tab): WorkspaceItem => ({ type: "tab", ...t });

export function sampleSnapshot(): TabsSnapshot {
  return {
    windowId: 1,
    activeTabId: 12,
    activeWorkspaceId: 1700000000001,
    workspaces: [
      {
        id: 0,
        name: "Default",
        icon: { svg: FOLDER_SVG },
        tabCount: 3,
        items: [
          loose(tab(1, "Inbox", "https://mail.example.com/", { pinned: true })),
          loose(tab(2, "Vivaldi Forum", "https://forum.vivaldi.net/")),
          loose(tab(3, "Settings", "vivaldi://settings/", { discarded: true })),
        ],
      },
      {
        id: 1700000000001,
        name: "Work",
        icon: { svg: BRIEFCASE_SVG },
        tabCount: 7,
        items: [
          loose(tab(10, "Pull requests", "https://git.example.com/pulls")),
          {
            type: "stack",
            id: "6f1c2a9e-0000-4000-8000-000000000001",
            name: "Diagram Design",
            customName: true,
            color: "color2",
            tabs: [
              tab(11, "Flowchart basics", "https://docs.example.com/flowcharts"),
              tab(12, "Sequence diagrams", "https://docs.example.com/sequence", { active: true }),
              tab(13, "Color theory", "https://design.example.com/color"),
            ],
          },
          {
            type: "stack",
            id: "6f1c2a9e-0000-4000-8000-000000000002",
            name: "Build log #482",
            customName: false,
            color: null,
            tabs: [
              tab(14, "Build log #482", "https://ci.example.com/builds/482"),
              tab(15, "Build log #481", "https://ci.example.com/builds/481"),
            ],
          },
          loose(tab(16, "Meeting notes", "https://notes.example.com/today")),
        ],
      },
      {
        id: 1700000000002,
        name: "Games",
        icon: { emoji: "🎮" },
        tabCount: 2,
        items: [
          loose(tab(20, "Lo-fi radio", "https://music.example.com/live", { audible: true })),
          loose(tab(21, "Chess puzzle", "https://chess.example.com/puzzle", { muted: true })),
        ],
      },
      {
        id: 1700000000003,
        name: "Reading",
        icon: { emoji: "📚" },
        tabCount: 0,
        items: [],
      },
    ],
  };
}

export function sampleReadingList(): ReadingListEntry[] {
  const day = 24 * 60 * 60 * 1000;
  const base = Date.UTC(2026, 10, 1);
  return [
    { url: "https://blog.example.com/keyboard-first", title: "Designing keyboard-first UIs", read: false, lastUpdate: base + 5 * day },
    { url: "https://news.example.com/browsers", title: "The state of browsers", read: true, lastUpdate: base + 2 * day },
    { url: "https://essays.example.com/fuzzy", title: "How fuzzy matching works", read: false, lastUpdate: base + 9 * day },
    { url: "file:///Users/example/notes.html", title: "Local notes", read: false, lastUpdate: base },
  ];
}
