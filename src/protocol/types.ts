// Shapes of the protocol in VIVALDI.md. Keep in sync with that document.

export const VIVALDI_ID = "mpognobbkildjkofajifpdfhcoklimli";
export const API = "vivaldi-manager";
export const PROTOCOL_VERSION = 1;

export interface Tab {
  id: number;
  title: string;
  url: string;
  favIconUrl: string;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  active: boolean;
  discarded: boolean;
}

export type StackColor =
  | "color1"
  | "color2"
  | "color3"
  | "color4"
  | "color5"
  | "color6"
  | "color7"
  | "color8"
  | "color9";

export interface Stack {
  type: "stack";
  id: string;
  name: string;
  customName: boolean;
  color: StackColor | null;
  tabs: Tab[];
}

export type WorkspaceItem = ({ type: "tab" } & Tab) | Stack;

export type WorkspaceIcon = { emoji: string } | { svg: string };

export interface Workspace {
  /** 0 = Default (tabs with no workspace). */
  id: number;
  name: string;
  icon: WorkspaceIcon;
  /** All tabs, including those inside stacks. */
  tabCount: number;
  /** Tab strip order. */
  items: WorkspaceItem[];
}

export interface TabsSnapshot {
  windowId: number;
  activeTabId: number;
  activeWorkspaceId: number;
  /** Default first, then Vivaldi's workspace order. */
  workspaces: Workspace[];
}

export interface ReadingListEntry {
  url: string;
  title: string;
  read: boolean;
  /** ms since epoch */
  lastUpdate: number;
}

export type MoveTarget = { tabId: number } | { stackId: string } | { workspaceId: number };

export interface MoveTabsArgs {
  tabIds?: number[];
  stackIds?: string[];
  target: MoveTarget;
  position: "before" | "after";
  intoStack?: boolean;
}

export interface AddToReadingListResult {
  added: string[];
  skipped: { url: string; reason: string }[];
}

export interface PingResult {
  modVersion: string;
  vivaldiVersion: string;
}

/** Messages the mod pushes to the popup after `subscribe`. */
export type PushMessage = { api: typeof API; windowId: number } & (
  | { push: "tabs"; snapshot: TabsSnapshot }
  | { push: "readingList"; entries: ReadingListEntry[] }
);

export const STACK_COLORS: Record<StackColor, { name: string; rgb: string }> = {
  color1: { name: "Grey", rgb: "rgb(96, 100, 105)" },
  color2: { name: "Blue", rgb: "rgb(26, 115, 233)" },
  color3: { name: "Red", rgb: "rgb(227, 0, 14)" },
  color4: { name: "Yellow", rgb: "rgb(250, 171, 0)" },
  color5: { name: "Green", rgb: "rgb(23, 128, 56)" },
  color6: { name: "Pink", rgb: "rgb(208, 24, 132)" },
  color7: { name: "Purple", rgb: "rgb(162, 66, 244)" },
  color8: { name: "Teal", rgb: "rgb(0, 125, 133)" },
  color9: { name: "Orange", rgb: "rgb(250, 144, 62)" },
};
