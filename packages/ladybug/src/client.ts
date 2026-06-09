import { Database, Connection, PreparedStatement, type LbugValue } from "@ladybugdb/core";
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { ensureSchema } from "./schema.ts";

export interface PingResult {
  ok: boolean;
  latencyMs: number;
}

let db: Database | null = null;
let conn: Connection | null = null;
let connecting: Promise<void> | null = null;

export async function connectLadybug(): Promise<void> {
  if (conn !== null) {
    return;
  }
  if (connecting !== null) {
    return connecting;
  }
  connecting = doConnect().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function doConnect(): Promise<void> {
  let dbPath = getConfigValue(Config.LadybugPath);
  if (dbPath === "") {
    dbPath = ":memory:";
  }

  try {
    db = new Database(dbPath);
    conn = new Connection(db);
    await ensureSchema(conn);
  } catch (cause: unknown) {
    if (db) {
      db = null;
    }
    conn = null;
    throw new Error(
      `Failed to connect to LadybugDB at '${dbPath}': ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

export async function closeLadybug(): Promise<void> {
  // Drop cached prepared statements first: each is bound to the connection we
  // are about to close, so reusing one after a reconnect would execute against
  // a destroyed handle. (`__resetForTests` already does this; the production
  // close path must too.)
  preparedCache.clear();

  const openConn = conn;
  const openDb = db;
  conn = null;
  db = null;

  // Release the native handles so the on-disk file lock is freed and pending
  // writes are flushed. Best-effort: a failed connection close must not block
  // the database close.
  try {
    if (openConn !== null) {
      await openConn.close();
    }
  } catch {
    // ignore
  }
  try {
    if (openDb !== null) {
      await openDb.close();
    }
  } catch {
    // ignore
  }
}

export async function pingLadybug(): Promise<PingResult> {
  if (conn === null) {
    return { ok: false, latencyMs: 0 };
  }
  const start = performance.now();
  try {
    await conn.query("MATCH (k:Knowledge) RETURN count(k) LIMIT 1");
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - start) };
  }
}

export function _getConnection(): Connection {
  if (conn === null) {
    throw new Error("LadybugDB not connected. Call connectLadybug() first.");
  }
  return conn;
}
//OPTIMIZATION NEEDED
// export async function _runCypher<T = unknown>(query: string, params: Record<string, any> = {}): Promise<T[]> {
//   const c = _getConnection();
//   const prepared = await c.prepare(query);
//   if (!prepared.isSuccess()) {
//     throw new Error(`Failed to prepare query: ${prepared.getErrorMessage()}`);
//   }
//   const result = await c.execute(prepared, params);
//   const singleResult = Array.isArray(result) ? result[0] : result;
//   if (!singleResult) {
//     throw new Error("No query result returned from LadybugDB");
//   }
//   const rows = await singleResult.getAll();
//   return rows as T[];
// }

// Cache compiled plans so repeated, parameter-stable queries (the MERGE /
// DELETE / search builders) only pay preparation cost once. Keyed by query
// text — see `_runCypherOnce` for queries whose text is unique per call.
const preparedCache = new Map<string, PreparedStatement>();

async function executePrepared<T>(
  c: Connection,
  prepared: PreparedStatement,
  params: Record<string, LbugValue>,
): Promise<T[]> {
  const result = await c.execute(prepared, params);
  const singleResult = Array.isArray(result) ? result[0] : result;
  if (!singleResult) {
    throw new Error("No query result returned from LadybugDB");
  }
  const rows = await singleResult.getAll();
  return rows as T[];
}

export async function _runCypher<T = unknown>(query: string, params: Record<string, LbugValue> = {}): Promise<T[]> {
  const c = _getConnection();

  // Reuse the compiled plan if we have seen this exact query before.
  let prepared = preparedCache.get(query);
  if (!prepared) {
    prepared = await c.prepare(query);
    if (!prepared.isSuccess()) {
      throw new Error(`Failed to prepare query: ${prepared.getErrorMessage()}`);
    }
    preparedCache.set(query, prepared);
  }

  return executePrepared<T>(c, prepared, params);
}

// One-shot execution for queries whose text is unique per call — notably the
// `COPY <table> FROM '<temp path>'` commands in `bulkUpsertFiles`, whose
// embedded parquet path differs every time. Caching those would grow
// `preparedCache` without bound (one dead native PreparedStatement per call),
// defeating the cache and leaking memory. Prepare, run, and let the statement
// be collected.
export async function _runCypherOnce<T = unknown>(query: string, params: Record<string, LbugValue> = {}): Promise<T[]> {
  const c = _getConnection();
  const prepared = await c.prepare(query);
  if (!prepared.isSuccess()) {
    throw new Error(`Failed to prepare query: ${prepared.getErrorMessage()}`);
  }
  return executePrepared<T>(c, prepared, params);
}

// Clear the cache if tests reset
export function __resetForTests(): void {
  db = null;
  conn = null;
  connecting = null;
  preparedCache.clear(); // Clear cache here
}
