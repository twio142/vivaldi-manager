# Plan

MVP first, visual styling last. The extension talks to Vivaldi only through the message protocol in [VIVALDI.md](VIVALDI.md), which is the contract with the JS mod. The mod is built separately, outside this repo.

## Phase 0: Research ✅

Done: [VIVALDI.md](VIVALDI.md) covers transport, window routing, the protocol (actions, pushes, snapshot shapes), what Vivaldi stores, favicons and the manifest.

## Phase 1: Foundation ✅

- **Scaffold:** MV3 extension with TS, bundled with Vite. Keep the popup light for fast startup (vanilla TS or Preact/Solid).
- **Manifest:** generate the `key` (see VIVALDI.md) so the extension id is stable; put the id in the README. Permissions: `favicon`, `storage`.
- **Protocol client:** the only module that talks to the mod. It exposes plain functions (`moveTabs`, `createStack`, `onTabs`, …) and handles the envelope (`api`, `v`, `windowId`), turns `{ error }` into thrown errors, reports "mod not installed" on connection errors, and owns the push listener and `subscribe`. It also holds the TypeScript types for the snapshot, Tab, stack and reading list entry.
- **Mock backend:** an in-memory fake implementing the same interface, seeded with realistic snapshots and pushing updates after each action. Lets Phases 2–5 be built and tested without the mod.
- **Pure state core:** the keyboard state machine (normal/move/search modes, focus, selection) as plain functions with no browser dependency, so the tricky rules (wrap-around, `J/K` bypassing stacks, single-workspace selection, moving into vs over stacks) are unit-testable.

## Phase 2: MVP (read-mostly)

1. Tabs view: workspace, stack and tab rows; "Default" workspace; empty workspaces shown (they're the drop target for moving into an empty workspace); tab-bar order; current tab focused on open.
2. Navigation and basic actions: `j/k`, `J/K`, `enter` to activate, `x` to close (on a stack row, closes all its tabs, no confirmation), `y` to copy.
3. Reading list view with basic actions (`enter`, `x`, `y`, `r`), and `ctrl-n` to switch views.
4. Live updates from pushes; "mod not installed" state; error toasts.

## Integration check

As soon as a first version of the mod exists: `ping`, `subscribe` with pushes arriving in the popup, one `moveTabs`, one `createStack`. Pushes are the one part that would change the architecture if they don't work, so check them early. After this, switch from the mock to the real client and keep the mock for tests.

## Phase 3: Mutations

- Selection (`tab`)
- Add to reading list (`s` for current/selected, `S` for all tabs in the current window), reporting `skipped` URLs
- Stacking (`g`, `G`)
- Stack rename (`i`) and stack color (Vivaldi's 9-color palette)
- Move mode (`v`) last, as it's the hardest. It always moves only the focused row (a tab, or a whole stack), never the selection. Cases: crossing workspaces, joining stacks, moving a whole stack, moving into an empty workspace (workspace rows aren't focusable, so `j/k` stops at an empty workspace and drops the tab into it with `target: { workspaceId }`). One `moveTabs` per key press with an optimistic local reorder.

## Phase 4: Search and sorting

- Fuzzy search in both views
- Reading list sorting (date uses `lastUpdate`) and hide-read toggle, persisted in `chrome.storage.local`

## Phase 5: Mouse

- Close button on hover
- Drag and drop, reusing the move-mode logic from Phase 3. Drags only the dragged row (a tab, or a whole stack)

## Phase 6: Visual style
