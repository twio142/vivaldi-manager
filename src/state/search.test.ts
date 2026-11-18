import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../protocol/fixture";
import { buildRows } from "./rows";
import { searchRows } from "./search";

const STACK_A = "6f1c2a9e-0000-4000-8000-000000000001";
const STACK_B = "6f1c2a9e-0000-4000-8000-000000000002";

// Rows: Default [1, 2, 3] · Work [10, A(11, 12, 13), B(14, 15), 16] · Games [20, 21] · Reading []
const rows = buildRows(sampleSnapshot());
const keys = (query: string) => searchRows(rows, query).rows.map((r) => r.key);

describe("searchRows", () => {
  it("returns every row for an empty query", () => {
    expect(searchRows(rows, " ").rows).toBe(rows);
  });

  it("keeps a matching tab's workspace and stack for context", () => {
    expect(keys("sequence")).toEqual(["ws:1700000000001", "stack:" + STACK_A, "tab:12"]);
  });

  it("shows a stack matched by name without its tabs", () => {
    const result = searchRows(rows, "diagram design");
    expect(result.rows.map((r) => r.key)).toEqual(["ws:1700000000001", "stack:" + STACK_A]);
    expect(result.matches.get("stack:" + STACK_A)?.field).toBe("name");
  });

  it("matches URLs too, and says so", () => {
    const result = searchRows(rows, "chess.example");
    expect(result.rows.map((r) => r.key)).toEqual(["ws:1700000000002", "tab:21"]);
    expect(result.matches.get("tab:21")?.field).toBe("url");
  });

  it("keeps list order and points at the best match", () => {
    const result = searchRows(rows, "build log");
    expect(result.rows.map((r) => r.key)).toEqual([
      "ws:1700000000001",
      "stack:" + STACK_B,
      "tab:14",
      "tab:15",
    ]);
    expect(result.best).not.toBeNull();
  });

  it("returns nothing when nothing matches", () => {
    expect(searchRows(rows, "zzzz")).toMatchObject({ rows: [], best: null });
  });
});
