import { useState } from "preact/hooks";

// Tries the tab's own icon, then Chromium's favicon cache, then draws a letter tile. Never asks a
// third-party service: that would leak every URL (see VIVALDI.md *Favicons*).

function sources(pageUrl: string, iconUrl: string): string[] {
  const list: string[] = [];
  if (/^(https?|data):/.test(iconUrl)) list.push(iconUrl);
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    list.push(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`));
  }
  return list;
}

function letter(pageUrl: string): string {
  try {
    const { hostname } = new URL(pageUrl);
    return (hostname.replace(/^www\./, "")[0] ?? "?").toUpperCase();
  } catch {
    return "?";
  }
}

export function Favicon({ pageUrl, iconUrl = "" }: { pageUrl: string; iconUrl?: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources(pageUrl, iconUrl).find((s) => !failed.includes(s));
  if (!src) return <span class="favicon letter">{letter(pageUrl)}</span>;
  return <img class="favicon" src={src} alt="" onError={() => setFailed((f) => [...f, src])} />;
}
