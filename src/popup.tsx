import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ModNotInstalledError, createVivaldiClient, type VivaldiClient } from "./protocol/client";
import { createMockClient } from "./protocol/mock";
import type { PingResult, ReadingListEntry, TabsSnapshot } from "./protocol/types";

// Phase 1 debug popup: connects (to the mod, or to the mock outside Vivaldi or with `?mock`) and
// dumps what arrives. Replaced by the real UI in Phase 2.

type Status =
  | { kind: "connecting" }
  | { kind: "ready"; ping: PingResult }
  | { kind: "not-installed" }
  | { kind: "error"; message: string };

const useMock = typeof chrome === "undefined" || !chrome.runtime?.id || new URLSearchParams(location.search).has("mock");

async function connect(): Promise<VivaldiClient> {
  if (useMock) return createMockClient({ latencyMs: 30 });
  const { id } = await chrome.windows.getCurrent();
  return createVivaldiClient(id!);
}

function App() {
  const [status, setStatus] = useState<Status>({ kind: "connecting" });
  const [snapshot, setSnapshot] = useState<TabsSnapshot | null>(null);
  const [entries, setEntries] = useState<ReadingListEntry[] | null>(null);

  useEffect(() => {
    let client: VivaldiClient | undefined;
    (async () => {
      client = await connect();
      client.onTabs(setSnapshot);
      client.onReadingList(setEntries);
      const ping = await client.ping();
      await client.subscribe();
      setStatus({ kind: "ready", ping });
    })().catch((e: unknown) => {
      if (e instanceof ModNotInstalledError) setStatus({ kind: "not-installed" });
      else setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    });
    return () => client?.dispose();
  }, []);

  return (
    <main style={{ font: "12px/1.4 ui-monospace, monospace", padding: "8px", width: "480px" }}>
      <p>
        {useMock ? "mock" : "mod"} ·{" "}
        {status.kind === "ready"
          ? `connected (mod ${status.ping.modVersion}, Vivaldi ${status.ping.vivaldiVersion})`
          : status.kind === "error"
            ? `error: ${status.message}`
            : status.kind === "not-installed"
              ? "Vivaldi mod not installed"
              : "connecting…"}
      </p>
      <details open>
        <summary>tabs</summary>
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
      <details>
        <summary>reading list</summary>
        <pre>{JSON.stringify(entries, null, 2)}</pre>
      </details>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
