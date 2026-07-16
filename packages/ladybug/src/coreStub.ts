// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
//
// Local stand-in for the native `@ladybugdb/core` addon.
//
// The native LadybugDB graph provider is NOT part of the ByteBell deployables
// (admin-server / knowledge-server): those use the Neo4j graph provider plus the
// on-disk JSONL ladybug dumps read by `@bytebell/utils`, and never load this
// native binding. `@ladybugdb/core` ships a large per-platform prebuilt native
// tarball that `bun` cannot extract under QEMU during multi-arch
// `docker buildx` on an Apple-Silicon host — which broke `make ecr-publish`
// ("Fail extracting tarball for @ladybugdb/core-linux-x64"). The external dep
// was therefore removed from `@bb/ladybug`'s manifest.
//
// These stubs preserve exactly the type surface `client.ts` / `provider.ts`
// compile against. Constructing or calling any of them throws — the native
// provider is simply unavailable in this build variant.

export type LbugValue = unknown;

const UNAVAILABLE = "LadybugDB native provider (@ladybugdb/core) is not available in this build.";

export interface QueryResult {
  getAll(): Promise<unknown[]>;
}

export class Database {
  constructor(_path: string) {
    throw new Error(UNAVAILABLE);
  }
}

export class PreparedStatement {
  isSuccess(): boolean {
    throw new Error(UNAVAILABLE);
  }

  getErrorMessage(): string {
    throw new Error(UNAVAILABLE);
  }
}

export class Connection {
  constructor(_db: Database) {
    throw new Error(UNAVAILABLE);
  }

  query(_query: string): Promise<QueryResult> {
    throw new Error(UNAVAILABLE);
  }

  prepare(_query: string): Promise<PreparedStatement> {
    throw new Error(UNAVAILABLE);
  }

  execute(_prepared: PreparedStatement, _params: Record<string, LbugValue>): Promise<QueryResult | QueryResult[]> {
    throw new Error(UNAVAILABLE);
  }
}
