import { describe, expect, it } from "bun:test";
import { metaId } from "./paths.ts";

/**
 * `metaId` — the deterministic, filesystem-safe storage-key hash that REPLACES `encodeMetaPath`. A single
 * fixed-width component is immune to path depth (the ENAMETOOLONG fix on deeply-nested repos); the `id → path`
 * inverse is persisted in `path-map.json` for the reverse.
 */
describe("metaId", () => {
  it("is deterministic", () => {
    expect(metaId("src/a/b.ts")).toBe(metaId("src/a/b.ts"));
  });

  it("is 64 lowercase hex chars", () => {
    expect(metaId("src/a/b.ts")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes paths the old lossy slug would collide", () => {
    expect(metaId("a/b")).not.toBe(metaId("a_b"));
    expect(metaId("a/b")).not.toBe(metaId("a/b/"));
    expect(metaId("a/b")).not.toBe(metaId("a.b"));
  });

  it("normalizes backslashes to forward slashes (platform-independent)", () => {
    expect(metaId("a\\b\\c")).toBe(metaId("a/b/c"));
  });

  it("stays 64 chars no matter how deep the path (the ENAMETOOLONG regression guard)", () => {
    const deep = "x/".repeat(400) + "file.ts";
    expect(metaId(deep)).toHaveLength(64);
  });

  it("matches the known SHA-256 vector (locks the algorithm)", () => {
    expect(metaId("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
