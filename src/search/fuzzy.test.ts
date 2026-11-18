import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./fuzzy";

const score = (query: string, text: string) => fuzzyMatch(query, text)?.score ?? -Infinity;

describe("fuzzyMatch", () => {
  it("matches letters in order, not necessarily together", () => {
    expect(fuzzyMatch("ghpr", "GitHub Pull Requests")?.positions).toEqual([0, 3, 7, 12]);
    expect(fuzzyMatch("rp", "GitHub Pull Requests")).toBeNull();
  });

  it("doesn't forgive typos", () => {
    expect(fuzzyMatch("githbu", "GitHub")).toBeNull();
  });

  it("needs every space-separated term, in any order", () => {
    expect(fuzzyMatch("pr git", "GitHub Pull Requests")).not.toBeNull();
    expect(fuzzyMatch("pr gitlab", "GitHub Pull Requests")).toBeNull();
  });

  it("ignores case unless the term has an uppercase letter", () => {
    expect(fuzzyMatch("github", "GitHub")).not.toBeNull();
    expect(fuzzyMatch("Github", "GitHub")).toBeNull();
    expect(fuzzyMatch("GH", "GitHub")).not.toBeNull();
  });

  it("matches everything with an empty query", () => {
    expect(fuzzyMatch("  ", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("picks the tightest window", () => {
    expect(fuzzyMatch("pr", "Open pull requests")?.positions).toEqual([5, 10]);
  });

  it("ranks word starts, runs and early matches higher", () => {
    expect(score("pr", "pull requests")).toBeGreaterThan(score("pr", "approve"));
    expect(score("log", "Build log")).toBeGreaterThan(score("log", "lo-fi radio (great)"));
    expect(score("git", "GitHub")).toBeGreaterThan(score("git", "Digital"));
    expect(score("fb", "fooBar")).toBeGreaterThan(score("fb", "foobar"));
  });
});
