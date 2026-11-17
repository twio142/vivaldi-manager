/**
 * The key name the state machines expect (`"j"`, `"J"`, `"Tab"`, `"Escape"`, …), `"ctrl-n"` for the
 * view switch, or null for keys with modifiers the popup never handles.
 */
export function keyName(e: KeyboardEvent): string | null {
  if (e.isComposing) return null;
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") return "ctrl-n";
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "Tab" && e.shiftKey) return null;
  return e.key;
}
