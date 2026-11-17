# Talking to Vivaldi

Research notes for implementing the Vivaldi Manager extension. Everything here was read out of Vivaldi 8.3.4191.44 (`bundle.js` in the app bundle) or is already proven by the user's other Vivaldi mods, which use the same mechanisms.

## The big picture

```
popup (this extension)
   │  chrome.runtime.sendMessage  ⇄  "mpognobbkildjkofajifpdfhcoklimli"   (requests one way, pushes back)
   ▼
Vivaldi's UI page, window.html (one copy per browser window)
   └─ JS mod "vivaldi-manager.js" (installed separately into Vivaldi; not part of this repo)
        ├─ chrome.* APIs (tabs, windows)
        ├─ vivaldi.* private APIs (tabsPrivate, readingListPrivate)
        └─ Vivaldi's own internal functions (workspace store, page actions), found at runtime
```

Workspaces, tab stacks and the reading list are Vivaldi features that no public extension API exposes. Vivaldi's own UI is itself an extension, and a user-installed JS mod runs inside it with access to its private APIs. The mod answers this extension's messages. **This extension never touches Vivaldi internals itself; it only speaks the message protocol below.**

The mod does not exist yet. It will be written against the protocol in this document, so treat the protocol as the contract. If the extension needs something the protocol lacks, change this document first.

## Vivaldi's runtime id

```js
const VIVALDI_ID = "mpognobbkildjkofajifpdfhcoklimli";
```

This is the extension id of Vivaldi's built-in UI (`chrome-extension://mpognobbkildjkofajifpdfhcoklimli/window.html`). It is fixed and the same on every Vivaldi install. An existing mod of the user's (`open-extension-popup.js`) already receives `chrome.runtime.sendMessage(VIVALDI_ID, …)` from another extension this way, so the channel is proven. The sender needs no `externally_connectable` entry or special permission for this.

## This extension's id must be stable

The mod only answers senders on its allowlist, and the allowlist holds this extension's id. An unpacked extension's id is derived from its path unless the manifest has a `key`, so **add a `key` to `manifest.json`** and keep it forever:

```sh
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem          # keep key.pem out of git
openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A           # → manifest "key"
openssl rsa -in key.pem -pubout -outform DER | shasum -a 256 | head -c32 | tr 0-9a-f a-p   # → extension id
```

Put the resulting id in the README so the mod can be configured with it.

## Window routing

Every Vivaldi window runs its own copy of the mod, and an external message reaches **all** of them. So every request names the window it is about, and only that window's copy answers.

- Get the popup's window with `(await chrome.windows.getCurrent()).id` and send it as `windowId` on every request.
- If no copy answers, `chrome.runtime.lastError` / the rejected promise says either "Could not establish connection. Receiving end does not exist." or "The message port closed before a response was received." Both mean the mod is not installed, is outdated, or doesn't know this window. Show a clear "Vivaldi mod not installed" state instead of an empty list.

## Protocol

### Envelope

Request, via `chrome.runtime.sendMessage(VIVALDI_ID, request)`:

```js
{ api: "vivaldi-manager", v: 1, windowId, action, ...args }
```

- `api` lets the mod ignore unrelated messages. `v` is the protocol version; the mod answers `{error: "unsupported version"}` for a version it doesn't know.

Response:

```js
{ ok: true, ...result }   // success
{ error: "message" }      // failure; nothing was changed unless the message says otherwise
```

Every action is async on Vivaldi's side. The mod responds once the Vivaldi call has returned, but the tab strip may still be settling. Don't read a fresh snapshot right after an action and assume it already reflects the change. Rely on the pushed updates (next section).

### Live updates: pushed back with `sendMessage`

Messages go both ways over the same one-shot `sendMessage` channel; no long-lived port. (A port was considered and dropped: Chrome's docs don't say what the sender sees when the port reaches every window's copy of the mod and all but one disconnect.)

1. When the popup opens, it registers a listener, then subscribes:

   ```js
   chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
     if (sender.id !== VIVALDI_ID || msg?.api !== "vivaldi-manager") return;
     if (msg.windowId !== windowId) return; // another window's push: don't reply, so that window stops pushing
     if (msg.push === "tabs") render(msg.snapshot);
     else if (msg.push === "readingList") renderReadingList(msg.entries);
     else return;
     sendResponse({ ok: true });
   });
   await chrome.runtime.sendMessage(VIVALDI_ID, { api: "vivaldi-manager", v: 1, windowId, action: "subscribe" });
   ```
2. The window's copy of the mod answers `{ ok: true }`, then pushes `{ api: "vivaldi-manager", windowId, push: "tabs", snapshot }` and `{ api: "vivaldi-manager", windowId, push: "readingList", entries }` right away, so the popup needs no initial `get…` request.
3. From then on it pushes again whenever that window's tabs, stacks or workspaces change (debounced, about 50 ms after the last change) and whenever the reading list changes.
4. **The popup replies `{ ok: true }` to every push it accepts.** Chrome's `sendMessage` always waits for a reply. The mod treats anything other than that reply as "popup closed" and stops pushing until the next `subscribe`, whether the result is an error or a different reply. That way it never depends on the wording of Chrome's error messages. A popup that receives a push but doesn't reply gets its first update and nothing after it.
   - The popup ignores, and doesn't reply to, pushes whose `windowId` isn't its own window's. A push reaches every open page of the extension, and a reply from the wrong window's popup would keep that window's mod pushing for nobody.
5. Only one popup per window is subscribed at a time; a new `subscribe` replaces the old one.

The listener must be in the popup page, not the service worker. Otherwise a push could arrive in the wrong place or wake the worker for nothing. If the extension also has a service worker that listens to `onMessageExternal`, it must ignore `push` messages.

### Actions

| action | args | result |
| --- | --- | --- |
| `ping` | | `{ ok, modVersion, vivaldiVersion }` |
| `subscribe` | | `{ ok }`, then pushes (see above) |
| `getTabs` | | `{ ok, snapshot }` (see below) |
| `activateTab` | `tabId` | `{ ok }`. Switches the window to the tab's workspace if needed, as clicking it in Vivaldi's window panel does. |
| `closeTabs` | `tabIds` | `{ ok }`. To close a stack, pass all its tab ids. |
| `moveTabs` | `tabIds?`, `stackIds?`, `target`, `position`, `intoStack?` | `{ ok }`. See *Moving*. |
| `createStack` | `tabIds` | `{ ok, stackId }`. Error if tab stacking is off in Vivaldi's settings or the tabs mix pinned and unpinned. |
| `removeFromStack` | `tabIds` | `{ ok }`. See *Stacks* for where the tabs end up. |
| `dissolveStack` | `stackId` | `{ ok }`. The tabs stay where they are, unstacked. |
| `renameStack` | `stackId`, `name` | `{ ok }`. `""` clears the custom name. |
| `setStackColor` | `stackId`, `color` | `{ ok }`. `color` is `"color1"`…`"color9"` or `null` for none. |
| `addToReadingList` | `items: [{ url, title }]` | `{ ok, added: [url], skipped: [{ url, reason }] }` |
| `getReadingList` | | `{ ok, entries }` |
| `setRead` | `url`, `read` | `{ ok }` |
| `removeFromReadingList` | `url` | `{ ok }` |
| `openReadingListItem` | `url` | `{ ok }`. Does what Vivaldi's reading list panel does: opens the URL in this window, switching to an existing tab if the page is already open, and marks the item read. |

The extension copies URLs itself, with `navigator.clipboard.writeText` in the popup. A key press counts as the user gesture it needs.

### The tabs snapshot

```js
{
  windowId: 123,
  activeTabId: 456,
  activeWorkspaceId: 0,              // 0 = Default
  workspaces: [                      // Default first, then Vivaldi's workspace order
    {
      id: 0,                         // 0 = Default (tabs with no workspace); otherwise Vivaldi's numeric id
      name: "Default",               // Default has no stored name; the mod uses "Default"
      icon: { emoji: "🎮" } | { svg: "<svg …>" } | null,   // emoji wins when both are set, as in Vivaldi; null if none could be found
      tabCount: 4,                   // all tabs, including those inside stacks
      items: [                       // tab strip order
        { type: "tab", ...Tab },
        { type: "stack", id: "6f1c…", name: "Diagram Design", customName: true,
          color: "color2" | null, tabs: [Tab, Tab] },
      ],
    },
  ],
}

// Tab
{
  id: 456,                // chrome tab id; the same id Vivaldi uses internally
  title: "…",             // the user's custom tab title if they renamed the tab, else the page title
  url: "https://…",
  favIconUrl: "…" | "",
  audible: true,          // playing sound right now
  muted: false,
  pinned: false,
  active: true,
  discarded: false,       // hibernated
}
```

Notes:

- Workspaces with no tabs in this window are included with `tabCount: 0`. Hide them or not; that's the extension's choice.
- **Order** is the tab strip's. Pinned tabs come first in the strip, and a stack's tabs are always contiguous.
- Rendering stack colors needs the color table under *Stacks*.

### Moving

Moving is one call in Vivaldi, the same one its window panel's drag and drop uses, so all three spec cases go through `moveTabs`:

```js
{ action: "moveTabs",
  tabIds: [1, 2],            // loose tabs being moved (may be empty)
  stackIds: ["6f1c…"],       // whole stacks being moved (may be empty)
  target: { tabId: 9 } | { stackId: "…" } | { workspaceId: 0 },
  position: "before" | "after",
  intoStack: false }
```

- **Reorder**: target the neighbor row and say `before` or `after`.
- **Join a stack** ("moving a tab between two stacked tabs adds the tab to the stack"): target one of the stack's tabs with `intoStack: true`. With `intoStack: false` and a stack as target, the tab goes next to the whole stack instead (what `J`/`K` in move mode want).
- **Leave a stack**: a stacked tab moved to a target outside its stack with `intoStack: false` leaves the stack.
- **Cross workspaces**: target a row in the other workspace. The mod moves the tabs into that workspace.
- **Into an empty workspace** (one with no tabs in this window): target `{ workspaceId }`; `position` and `intoStack` are ignored. Vivaldi's own move silently does nothing here because it places tabs after the workspace's last tab, and there is none. The mod opens a blank placeholder tab in the target workspace, moves the tabs, then closes the placeholder. The user's `workspace-move-tabs.js` mod already does exactly this.
- Moving a stack (`stackIds`) moves all of its tabs and keeps them stacked.
- Pinned and unpinned tabs can't share a stack, and Vivaldi keeps pinned tabs at the front. Expect a move that breaks these rules to be refused or corrected by Vivaldi.

For move mode (`v`, then `j`/`k`), send one `moveTabs` per key press and redraw from the next pushed snapshot. An optimistic local reorder in the meantime keeps it feeling instant.

## What Vivaldi stores, and what the mod derives

Background for understanding the snapshot. The extension doesn't need to parse any of this itself.

### Tabs and `vivExtData`

A Vivaldi tab is a normal Chromium tab plus a JSON string `vivExtData`, which holds everything Vivaldi-specific:

| field | meaning |
| --- | --- |
| `ext_id` | stable string id of the tab; Vivaldi's move call targets tabs by it |
| `workspaceId` | number; missing = Default workspace |
| `group` | stack id (a UUID); tabs with the same `group` form a stack |
| `fixedGroupTitle` | stack name the user typed; missing = no custom name |
| `groupColor` | `"color1"`…`"color9"`; missing = no color |
| `fixedTitle` | user's custom title for this tab (≤ 50 chars) |
| `panelId`, `tiling`, `vivaldi_tab_muted`, … | other features; ignored here |

Inside Vivaldi's UI, `chrome.tabs` returns `vivExtData`. The extension never reads it; the mod's snapshot carries everything needed in parsed form. Also, plain `chrome.tabs.query` can return tabs that aren't tabs in the strip (web panels, for one). The mod uses Vivaldi's own per-workspace page list, so the snapshot only has tabs Vivaldi itself shows.

### Workspaces

Vivaldi's workspace store gives `[{ id, name, icon, emoji, iconId }]` in menu order (also persisted in the pref `vivaldi.workspaces.list`). `icon` is an SVG string, `emoji` a string; Vivaldi shows the emoji when present. The Default workspace has no entry, name or icon. The mod uses "Default" and Vivaldi's default workspace icon (an SVG). Workspace ids are numbers; the mod uses `0` for Default (a convention shared with the user's other mods, since Vivaldi itself uses `undefined`).

SVG icons are monochrome and drawn with `currentColor`-style fills. Insert them as markup (they come from Vivaldi, which is trusted, but sanitize or use `<img src="data:image/svg+xml,…">` if in doubt) and set `color` to match the theme.

### Stacks

- A stack is the set of tabs in a window sharing `vivExtData.group`. **A group with only one tab is not a stack**: Vivaldi's tab bar and window panel both show it as a plain tab, and so does the snapshot.
- **Name**: `fixedGroupTitle` when set (`customName: true`). Otherwise Vivaldi's window panel shows the display title of the stack's most recently active tab (falling back to its first tab), and the snapshot does the same with `customName: false`. For the `i` (rename) input, prefill the shown name either way.
- **Color**: `groupColor`, set through Vivaldi's stack editor. The nine values, with Vivaldi's names and its own RGB values:

  | value | name | rgb |
  | --- | --- | --- |
  | `color1` | Grey | `rgb(96, 100, 105)` |
  | `color2` | Blue | `rgb(26, 115, 233)` |
  | `color3` | Red | `rgb(227, 0, 14)` |
  | `color4` | Yellow | `rgb(250, 171, 0)` |
  | `color5` | Green | `rgb(23, 128, 56)` |
  | `color6` | Pink | `rgb(208, 24, 132)` |
  | `color7` | Purple | `rgb(162, 66, 244)` |
  | `color8` | Teal | `rgb(0, 125, 133)` |
  | `color9` | Orange | `rgb(250, 144, 62)` |

  `null` means no color; draw the dot in a neutral or accent color.
- **Stacking can be turned off** (Settings > Tabs, pref `vivaldi.tabs.stacking.mode` = `"off"`). Then `createStack` fails with an error; show it.
- **Remove from stack**: `removeFromStack` calls Vivaldi's own "Remove from Tab Stack" (tab context menu), so the tabs land where that command puts them; the next pushed snapshot shows where. To take a tab out and keep it right next to the stack instead, use `moveTabs` targeting the stack with `position: "after"` and `intoStack: false`.

### Reading list

Vivaldi wraps Chromium's reading list as `vivaldi.readingListPrivate` (`getAll`, `add`, `remove`, `setReadStatus`, `onModelChanged`). What the mod passes on:

```js
// entry
{ url: "https://…", title: "…", read: false, lastUpdate: 1763380000000 }   // lastUpdate: ms since epoch
```

- **Entries are keyed by URL.** Every operation takes the URL; there is no other id. Adding a URL that is already in the list does not make a second entry.
- Only `http://`, `https://` and `file://` URLs can be added. Vivaldi checks this before adding, and the mod reports other URLs (e.g. `vivaldi://` pages) under `skipped`.
- `lastUpdate` is the only timestamp Vivaldi reads. Its own panel's "Date" sort uses it (labelled "Sort by Date Updated"), and so does its CSV export. Use it for "sort by date" and the order matches Vivaldi's panel.
- Entries carry no favicon. See *Favicons*.
- Vivaldi's own panel sort setting is the pref `vivaldi.reading_list.panel.sorting` (default `{ sortField: "read", sortOrder: 3 }`). The extension keeps its own sort and hide-read settings in `chrome.storage.local`; it doesn't need Vivaldi's.

## Favicons

- Tabs: `favIconUrl` from the snapshot. It can be empty, a `data:` URL, or an `http(s)` URL. Internal pages (`vivaldi://…`, `chrome://…`) may have URLs an extension page can't load.
- Reading list items, and any tab whose icon fails to load: use Chromium's favicon service, `chrome.runtime.getURL("/_favicon/?pageUrl=" + encodeURIComponent(url) + "&size=32")`, with `"permissions": ["favicon"]` in the manifest. It serves what's in the browser's favicon cache, needs no network, and falls back to a generic globe. If the image fails to load (`onerror`), draw a letter tile from the domain instead.
- Never fetch favicons from a third-party service: it would leak every URL in the reading list.

## Manifest checklist

- `"manifest_version": 3`
- `"key"`: see *This extension's id must be stable*.
- `"permissions": ["favicon", "storage"]`. No `tabs` permission is needed when all tab data comes from the mod.
- `"action": { "default_popup": "popup.html" }`. Vivaldi shows it as a toolbar popup.

## Debugging

- Vivaldi's UI, including the mod, can be inspected without any launch flag: open `vivaldi://inspect/#apps` and inspect `window.html` (one per browser window; pick the one being tested). The mod's warnings appear in that console.
- From the popup's own devtools (right-click in the popup > Inspect), a request can be tried by hand:

  ```js
  const { id: windowId } = await chrome.windows.getCurrent();
  await chrome.runtime.sendMessage("mpognobbkildjkofajifpdfhcoklimli",
    { api: "vivaldi-manager", v: 1, windowId, action: "getTabs" });
  ```
- After the mod is changed, Vivaldi must be restarted with Cmd+Q; open windows keep the old code.
- After the extension changes, reload it at `vivaldi://extensions`.
- A Vivaldi update can break the mod's access to internals. The mod then answers the affected actions with `{ error }` rather than doing something wrong, so surface errors to the user (a short toast is enough) instead of swallowing them.
