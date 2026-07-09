import { describe, expect, it } from "bun:test";
import { buildPathMap } from "./path-map.ts";
import { metaId } from "./pipeline/paths.ts";
import type { ScanManifest } from "./scan-manifest.ts";

function manifest(paths: string[]): ScanManifest {
  return {
    generatedAt: "t",
    summary: {
      totalFiles: paths.length,
      smallCount: paths.length,
      bigCount: 0,
      oversizedCount: 0,
      totalTokens: 0,
      estimatedBigChunks: 0,
    },
    entries: paths.map((relativePath) => ({
      relativePath,
      absolutePath: relativePath,
      sizeBytes: 0,
      tokenCount: 0,
      kind: "small" as const,
    })),
  };
}

/** `buildPathMap` — the pure `id → path` inverse of `metaId`, built once from the scan manifest. */
describe("buildPathMap", () => {
  it("maps every file's metaId back to its path", () => {
    const m = buildPathMap(manifest(["src/a.ts", "src/foo/b.ts"]));
    expect(m.files[metaId("src/a.ts")]).toBe("src/a.ts");
    expect(m.files[metaId("src/foo/b.ts")]).toBe("src/foo/b.ts");
  });

  it("includes every ancestor folder + the root sentinel", () => {
    const m = buildPathMap(manifest(["src/foo/bar/b.ts"]));
    expect(m.folders["__ROOT__"]).toBe("");
    expect(m.folders[metaId("src")]).toBe("src");
    expect(m.folders[metaId("src/foo")]).toBe("src/foo");
    expect(m.folders[metaId("src/foo/bar")]).toBe("src/foo/bar");
  });

  it("produces one distinct key per distinct file (no collisions)", () => {
    const paths = ["a/b.ts", "a_b.ts", "a.b.ts", "c/d.ts"];
    const m = buildPathMap(manifest(paths));
    expect(Object.keys(m.files)).toHaveLength(paths.length);
  });

  it("stamps the schema version + algo", () => {
    const m = buildPathMap(manifest(["x.ts"]));
    expect(m.version).toBe(1);
    expect(m.algo).toBe("sha256");
  });
});
