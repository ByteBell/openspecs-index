import { describe, expect, test } from "bun:test";
import { isFullCommitHash, normalizeCommitHashes, resolveIndexedCommit } from "./knowledge.ts";

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C_UPPER = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

describe("commit hash helpers", () => {
  test("accepts only full 40-character commit hashes", () => {
    expect(isFullCommitHash(HASH_A)).toBe(true);
    expect(isFullCommitHash(HASH_C_UPPER)).toBe(true);
    expect(isFullCommitHash("latest")).toBe(false);
    expect(isFullCommitHash("deadbee")).toBe(false);
    expect(isFullCommitHash("g".repeat(40))).toBe(false);
  });

  test("normalizes legacy string and object commit history", () => {
    expect(
      normalizeCommitHashes([
        null,
        undefined,
        HASH_A,
        HASH_A.toUpperCase(),
        { hash: HASH_B, inputTokens: "10", outputTokens: "5", costUsd: "0.01" },
        { hash: HASH_C_UPPER },
        "latest",
        "deadbee",
        { hash: "" },
        {},
      ]),
    ).toEqual([HASH_A, HASH_B, HASH_C_UPPER.toLowerCase()]);
    expect(normalizeCommitHashes(null)).toEqual([]);
    expect(normalizeCommitHashes(undefined)).toEqual([]);
  });

  test("resolves the indexed commit from commitId first", () => {
    expect(
      resolveIndexedCommit({
        kind: "github",
        repoUrl: "https://github.com/ByteBell/bytebell-oss",
        commitId: HASH_A,
        commitHashes: [HASH_B],
      }),
    ).toBe(HASH_A);
  });

  test("falls back to the newest valid history entry when commitId is not a hash", () => {
    expect(
      resolveIndexedCommit({
        kind: "github",
        repoUrl: "https://github.com/ByteBell/bytebell-oss",
        commitId: "latest",
        commitHashes: [HASH_A, { hash: HASH_B }],
      }),
    ).toBe(HASH_B);
  });

  test("returns undefined when no valid commit hash was recorded", () => {
    expect(
      resolveIndexedCommit({
        kind: "github",
        repoUrl: "https://github.com/ByteBell/bytebell-oss",
      }),
    ).toBeUndefined();
    expect(
      resolveIndexedCommit({
        kind: "github",
        repoUrl: "https://github.com/ByteBell/bytebell-oss",
        commitHashes: [],
      }),
    ).toBeUndefined();
    expect(
      resolveIndexedCommit({
        kind: "github",
        repoUrl: "https://github.com/ByteBell/bytebell-oss",
        commitId: "latest",
        commitHashes: ["deadbee", { hash: "" }],
      }),
    ).toBeUndefined();
  });
});
