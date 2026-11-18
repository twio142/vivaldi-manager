# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is pnpm.

- `pnpm build`: typecheck (`tsc --noEmit`) then Vite build into `dist/`. Load `dist/` unpacked at `vivaldi://extensions`, and reload it there after changes.
- `pnpm typecheck`: types only.
- `pnpm test`: Vitest, `src/**/*.test.ts`. Single file: `pnpm vitest run src/state/move.test.ts`. Single test: add `-t "<name>"`.
- `pnpm dev`: serves the popup in a normal browser tab, where it runs on the mock backend. Inside Vivaldi, `?mock` on the popup URL does the same.

## What this is

An MV3 Vivaldi extension (Preact + TypeScript, Vite) whose popup has two views, switched with `ctrl-n`: the current window's tabs grouped by workspace and stack, and the reading list. It is driven mostly from the keyboard (vim-style keys), with mouse support (close button on hover, drag and drop).

Workspaces, stacks and the reading list have no public extension API. All of that data and every mutation goes through `chrome.runtime.sendMessage` to a separately installed JS mod running inside Vivaldi's own UI page (`vivaldi/vivaldi-manager.js`). **VIVALDI.md is the contract with the mod**: envelope, window routing, actions table, push protocol, snapshot shape, move semantics. If the extension needs something the protocol lacks, change VIVALDI.md first. Exceptions handled by the extension itself: clipboard writes (`navigator.clipboard`), pinning (`chrome.tabs.update`), and prefs (`chrome.storage.local`).

The extension id is `dkdkfdhakeaaoomfiihhippegpampkod`, fixed by the `key` in `public/manifest.json` because the mod allowlists it. Never change or regenerate the key. `key.pem` stays out of git.

## Architecture

Layers, from the wire inward:

- `src/protocol/`: `client.ts` is the only code that talks to the mod. It adds the envelope (`api`, `v`, `windowId`), turns `{ error }` into `ModError`, connection failures into `ModNotInstalledError`, and handles pushes: the popup must reply `{ ok: true }` to each push for its own window and must not reply to other windows' pushes, or the mod stops/keeps pushing incorrectly. `mock.ts` implements the same `VivaldiClient` interface in memory (including pushes after each action) on top of `fixture.ts` sample data. `types.ts` mirrors the snapshot shapes in VIVALDI.md.
- `src/model/strip.ts`: converts the nested `TabsSnapshot` to a flat "strip" (each tab carries workspace and stack id) and back, and `applyMove` applies a `moveTabs` call to it. Shared by the mock and by the UI's optimistic reorder.
- `src/state/`: pure keyboard state machines with no browser dependency. `rows.ts` flattens a snapshot into display rows keyed by `tab:`/`stack:`/`ws:` strings, so focus and selection survive new snapshots (`reconcile`). `tabsView.ts` and `readingListView.ts` take `(state, rows, key)` and return the next state plus a list of effects (mod calls, clipboard writes) instead of performing them. `move.ts` (move mode) and `drop.ts` (drag and drop) compute the `moveTabs` args; `search.ts` filters rows while keeping grouping. Tests here are the main safety net for the tricky rules; their fixture rows are summarised in a comment at the top of each test file.
- `src/search/fuzzy.ts`: fzf-style matcher (letters in order, space-separated terms all match, smart case).
- `src/ui/`: Preact components. `App.tsx` owns the client, applies pushed snapshots, and runs effects through a serial queue. Moves are applied optimistically via `applyMove`; a refused move refetches the real order. `keys.ts` normalises `KeyboardEvent`s to the key names the state machines expect.

New behaviour normally means: add the rule to the pure state module with tests, emit an effect, then execute the effect in `App.tsx` (and in `mock.ts` if it's a new mod action).

## Debugging against real Vivaldi

- The mod runs in `window.html`; inspect it at `vivaldi://inspect/#apps` (one per window).
- After the mod changes, Vivaldi needs a full Cmd+Q restart.
- The mod answers broken internals with `{ error }`; surface those to the user (toast) rather than swallowing them.
