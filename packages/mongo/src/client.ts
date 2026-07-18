import { MongoClient, type Db } from "mongodb";
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { MongoConfigError, MongoConnectError, MongoNotConnectedError } from "@bb/errors";

export interface PingResult {
  ok: boolean;
  latencyMs: number;
}

let client: MongoClient | null = null;
let connecting: Promise<void> | null = null;

export async function connectMongo(): Promise<void> {
  if (client !== null) {
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
  const uri = getConfigValue(Config.MongoUri);
  if (uri.length === 0) {
    throw new MongoConfigError("bytebell set mongo <uri>");
  }
  const next = new MongoClient(uri);
  try {
    await next.connect();
  } catch (cause: unknown) {
    await next.close().catch(() => undefined);
    throw new MongoConnectError(uri, cause);
  }
  client = next;
}

export async function closeMongo(): Promise<void> {
  if (client === null) {
    return;
  }
  const c = client;
  client = null;
  await c.close();
}

export async function pingMongo(): Promise<PingResult> {
  const db = _getDb();
  const start = performance.now();
  try {
    await db.admin().ping();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - start) };
  }
}

export function _getDb(): Db {
  if (client === null) {
    throw new MongoNotConnectedError();
  }
  return client.db();
}

/**
 * Public accessor for the connected database handle. Consumers that own their own collection
 * logic — e.g. `@bb/ingest-core`'s scan, which writes the `ignored_files` audit collection — call
 * this to reach Mongo without a per-collection helper living here. Throws `MongoNotConnectedError`
 * until `connectMongo()` has completed.
 */
export function getMongoDb(): Db {
  return _getDb();
}

export function __resetForTests(): void {
  client = null;
  connecting = null;
}
