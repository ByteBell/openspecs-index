/**
 * Narrows the reshaped `contracts_provided` and `contracts_consumed` arrays into structured
 * {@link ContractDescriptor} entries. Pass-1 leaves `resolvedRelativePath` and `resolvedFileId`
 * as null — mcp-enrichment (pass-2) fills them.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type { ContractDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/v2/substrate.ts";
import { pickRecordArray } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";

/**
 * Parses an untrusted `contracts_*` array into structured {@link ContractDescriptor} entries.
 *
 * @param value - The untrusted contracts array.
 * @returns The parsed contracts (entries without a name are dropped).
 */
export function parseContracts(value: unknown): ContractDescriptor[] {
  const out: ContractDescriptor[] = [];
  for (const rec of pickRecordArray(value)) {
    const name = pickString(rec["name"], "");
    if (name.length === 0) {
      continue;
    }
    out.push({
      name,
      shape: pickString(rec["shape"], ""),
      resolvedRelativePath: null,
      resolvedFileId: null,
    });
  }
  return out;
}
