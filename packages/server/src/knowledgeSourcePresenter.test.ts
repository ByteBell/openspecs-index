import { describe, expect, test } from "bun:test";
import type { KnowledgeSource } from "@bb/types";
import { getLegacyInfo, normalizeRepoSource } from "./knowledgeSourcePresenter.ts";

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("knowledge source presentation", () => {
  test("preserves local sources unchanged", () => {
    const source: KnowledgeSource = { kind: "local", sourcePath: "/tmp/repo" };
    expect(normalizeRepoSource(source)).toBe(source);
  });

  test("normalizes current github source commit fields for /repos consumers", () => {
    expect(
      normalizeRepoSource({
        kind: "github",
        repoUrl: "https://github.com/ByteBell/bytebell-oss",
        branch: "main",
        commitId: HASH_A.toUpperCase(),
        commitHashes: [HASH_A, "latest", { hash: HASH_B.toUpperCase() }],
      }),
    ).toEqual({
      kind: "github",
      repoUrl: "https://github.com/ByteBell/bytebell-oss",
      branch: "main",
      commitId: HASH_A,
      commitHashes: [HASH_A, HASH_B],
    });
  });

  test("does not leak legacy commitId='latest' through /repos", () => {
    const legacySource = { kind: "github" } as KnowledgeSource;
    const info = {
      repoUrl: "https://github.com/ByteBell/bytebell-oss",
      githubInfo: {
        branchName: "main",
        commitId: "latest",
        commitHashes: [{ hash: HASH_A }, { hash: HASH_B }],
      },
    };

    expect(normalizeRepoSource(legacySource, info)).toEqual({
      kind: "github",
      repoUrl: "https://github.com/ByteBell/bytebell-oss",
      branch: "main",
      commitId: HASH_B,
      commitHashes: [HASH_A, HASH_B],
    });
  });

  test("extracts legacy info only from object-shaped entries", () => {
    const info = { githubInfo: { commitId: HASH_A } };
    expect(getLegacyInfo({ info })).toBe(info);
    expect(getLegacyInfo({ info: null })).toBeUndefined();
    expect(getLegacyInfo({ info: "not-object" })).toBeUndefined();
  });
});
