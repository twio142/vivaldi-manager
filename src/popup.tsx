import { render } from "preact";
import { createVivaldiClient, type VivaldiClient } from "./protocol/client";
import { createMockClient } from "./protocol/mock";
import { App } from "./ui/App";
import "./ui/styles.css";

// Outside Vivaldi (e.g. `pnpm dev` in a normal tab), or with `?mock`, the popup runs on the mock.
const useMock = typeof chrome === "undefined" || !chrome.runtime?.id || new URLSearchParams(location.search).has("mock");

async function connect(): Promise<VivaldiClient> {
  if (useMock) return createMockClient({ latencyMs: 30 });
  const { id } = await chrome.windows.getCurrent();
  return createVivaldiClient(id!);
}

render(<App connect={connect} />, document.getElementById("app")!);
