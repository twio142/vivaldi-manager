# Vivaldi Manager: A Keyboard-Driven Vivaldi Extension

Keyboard control for Vivaldi's workspaces, tab stacks and reading list, in a single popup. Vivaldi's own interface for these is built for the mouse. Here you use vim-style keys to fuzzy-search the current window's tabs, jump between them, move tabs across workspaces, create, rename and recolor stacks, and work through your reading list.

## Requirements

This extension relies on a companion [JS mod](vivaldi/vivaldi-manager.js) installed into Vivaldi.

> [!WARNING]
> Vivaldi doesn't officially support JS mods, and an update can break this one (tested with Vivaldi 8.3). The mod has full control over the browser, so read it before installing.

To install, add the file to Vivaldi's `window.html` with a `<script>` tag, and redo it after each Vivaldi update. See the [Modding Vivaldi](https://forum.vivaldi.net/category/52/modding-vivaldi) section of the Vivaldi forum for details.

## Usage

`ctrl-n` switches between the Tabs and Reading list views.

### Tabs

| Key           | Action                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `j` / `k`     | Move focus down / up (wraps around)                                                                                                          |
| `J` / `K`     | Same, skipping over the tabs inside stacks                                                                                                   |
| `enter` / `l` | Switch to the focused tab                                                                                                                    |
| `h`           | From a tab inside a stack, focus the stack                                                                                                   |
| `tab`         | Select the focused row and move to the next one (a stack selects all its tabs; one workspace at a time)                                      |
| `x`           | Close the focused or selected tabs, or a whole stack                                                                                         |
| `y`           | Copy the URLs                                                                                                                                |
| `p`           | Pin / unpin (a stacked tab pins with its whole stack)                                                                                        |
| `s`           | Add the focused or selected tabs to the reading list                                                                                         |
| `S`           | Add every tab in the window to the reading list                                                                                              |
| `g`           | Stack the selected tabs (at least two)                                                                                                       |
| `G`           | Dissolve the focused stack, or take the focused or selected tabs out of their stack                                                          |
| `i`           | Rename the focused stack (`enter` saves, `esc` cancels)                                                                                      |
| `c`           | Recolor the focused stack (`h`/`l` to pick, `enter` saves, `esc` cancels)                                                                    |
| `v`           | Move mode: `j`/`k` move the focused tab or stack, crossing into stacks and other workspaces; `J`/`K` hop over stacks; `v` or `esc` to finish |
| `/`           | Search tabs by title or URL and stacks by name; `esc` to leave                                                                               |

### Reading List

| Key           | Action                                   |
| ------------- | ---------------------------------------- |
| `j` / `k`     | Move focus down / up                     |
| `enter` / `l` | Open the item                            |
| `r`           | Mark read / unread                       |
| `x`           | Remove the item                          |
| `y`           | Copy the URL                             |
| `s`           | Cycle sorting: date, title, unread first |
| `h`           | Hide / show read items                   |
| `/`           | Search by title or URL                   |

Sorting and the hide-read setting are kept the next time you open the popup.

### Search

Search is fzf-style: type letters in the order they appear, separate terms with spaces, and every term has to match. Matching is case-sensitive only when a term contains a capital letter.
