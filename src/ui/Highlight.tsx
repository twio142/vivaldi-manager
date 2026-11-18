import type { ComponentChild } from "preact";

/** `text` with the characters at `positions` marked. */
export function Highlight({ text, positions }: { text: string; positions?: readonly number[] }) {
  if (!positions || positions.length === 0) return <>{text}</>;
  const marked = new Set(positions);
  const parts: ComponentChild[] = [];
  let run = "";
  let runMarked = false;
  const flush = () => {
    if (run) parts.push(runMarked ? <mark>{run}</mark> : run);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const m = marked.has(i);
    if (m !== runMarked) {
      flush();
      runMarked = m;
    }
    run += text[i];
  }
  flush();
  return <>{parts}</>;
}
