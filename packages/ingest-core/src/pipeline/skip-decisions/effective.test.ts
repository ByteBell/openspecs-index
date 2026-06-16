import { describe, expect, it } from "bun:test";
import { buildEffectiveIgnoreSets, defaultIgnorePatternLists } from "./effective.ts";

describe("buildEffectiveIgnoreSets", () => {
  it("returns the built-in defaults when no overrides are given", () => {
    const sets = buildEffectiveIgnoreSets();
    // Legacy defaults that are always present.
    expect(sets.directories.has("node_modules")).toBe(true);
    expect(sets.directories.has("dist")).toBe(true);
    expect(sets.extensions.has(".png")).toBe(true);
  });

  it("adds custom directory / filename patterns", () => {
    const sets = buildEffectiveIgnoreSets({
      directories: { add: ["myvendor"] },
      filenames: { add: ["NOTES.txt"] },
    });
    expect(sets.directories.has("myvendor")).toBe(true);
    expect(sets.filenames.has("NOTES.txt")).toBe(true);
    // Defaults still present alongside the additions.
    expect(sets.directories.has("node_modules")).toBe(true);
  });

  it("un-ignores a built-in default via remove", () => {
    const sets = buildEffectiveIgnoreSets({ directories: { remove: ["node_modules"] } });
    expect(sets.directories.has("node_modules")).toBe(false);
    // Untouched defaults remain.
    expect(sets.directories.has("dist")).toBe(true);
  });

  it("normalizes extension additions to lowercase with a leading dot", () => {
    const sets = buildEffectiveIgnoreSets({ extensions: { add: ["MIN.JS"] } });
    expect(sets.extensions.has(".min.js")).toBe(true);
  });

  it("adds and removes glob patterns by exact string", () => {
    const base = buildEffectiveIgnoreSets();
    const withGlob = buildEffectiveIgnoreSets({ globs: { add: ["*.custom"] } });
    expect(withGlob.globs).toContain("*.custom");
    expect(withGlob.globs.length).toBe(base.globs.length + 1);
  });

  it("exposes the defaults as sorted serializable arrays", () => {
    const lists = defaultIgnorePatternLists();
    expect(Array.isArray(lists.directories)).toBe(true);
    expect(lists.directories).toContain("node_modules");
    expect(lists.extensions).toContain(".png");
  });
});
