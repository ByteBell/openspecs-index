/**
 * Narrows the `local_call_graph` and `data_flow_graph` arrays into edge structs. Closed-enum
 * fields (`origin`, `kind`) fall back to a safe default when the model emits something off-list.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  DataFlowEdge,
  LocalCallEdge,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/substrate.ts";
import { pickRecordArray } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import { parseSourceAnchor } from "./anchors.ts";

const ORIGINS: ReadonlySet<LocalCallEdge["origin"]> = new Set(["local", "import", "this", "super", "global"]);
const CALL_KINDS: ReadonlySet<LocalCallEdge["kind"]> = new Set(["call", "construct", "await", "yield", "spawn"]);

/** Returns the string at `key`, or null when absent/empty. */
function optString(rec: Record<string, unknown>, key: string): string | null {
  return typeof rec[key] === "string" && (rec[key] as string).length > 0 ? (rec[key] as string) : null;
}

/**
 * Parses the untrusted `local_call_graph` array into {@link LocalCallEdge}s.
 *
 * @param value - The untrusted `local_call_graph` field.
 * @returns The parsed edges (entries without caller AND callee are dropped).
 */
export function parseLocalCallGraph(value: unknown): LocalCallEdge[] {
  const out: LocalCallEdge[] = [];
  for (const rec of pickRecordArray(value)) {
    const caller = pickString(rec["caller"], "");
    const callee = pickString(rec["callee"], "");
    if (caller.length === 0 || callee.length === 0) {
      continue;
    }
    const originRaw = pickString(rec["origin"], "local");
    const kindRaw = pickString(rec["kind"], "call");
    out.push({
      caller,
      callee,
      origin: ORIGINS.has(originRaw as LocalCallEdge["origin"])
        ? (originRaw as LocalCallEdge["origin"])
        : "local",
      kind: CALL_KINDS.has(kindRaw as LocalCallEdge["kind"])
        ? (kindRaw as LocalCallEdge["kind"])
        : "call",
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}

/**
 * Parses the untrusted `data_flow_graph` array into {@link DataFlowEdge}s.
 *
 * @param value - The untrusted `data_flow_graph` field.
 * @returns The parsed edges (entries without producer AND consumer are dropped).
 */
export function parseDataFlowGraph(value: unknown): DataFlowEdge[] {
  const out: DataFlowEdge[] = [];
  for (const rec of pickRecordArray(value)) {
    const producer = pickString(rec["producer"], "");
    const consumer = pickString(rec["consumer"], "");
    if (producer.length === 0 || consumer.length === 0) {
      continue;
    }
    out.push({
      producer,
      consumer,
      payload: pickString(rec["payload"], ""),
      transformation: optString(rec, "transformation"),
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}
