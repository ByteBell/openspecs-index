/**
 * Composes the per-field parsers into a {@link CodeUnit}. Identity and span fields are taken
 * from the trusted Stage-1 {@link UnitDescriptor} (the LLM is not trusted to restate them);
 * everything else is narrowed from the untrusted Prompt 2 JSON. `semanticFingerprint` is left
 * empty here — it is computed in code once the unit is finalised.
 */
import { pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/reconstruction/types/module-ir.ts";
import { pickBool } from "./primitives.ts";
import { parseLogicOutline } from "./logic-outline.ts";
import { parseNamedConstants } from "./named-constants.ts";
import {
  parseCalls,
  parseErrorPolicy,
  parseExampleIoPairs,
  parseMembers,
  parseParameters,
  parseVerbatimBlocks,
} from "./unit-fields.ts";

/** Returns the trimmed string at `key`, or null when absent/empty. */
function optString(raw: Record<string, unknown>, key: string): string | null {
  return typeof raw[key] === "string" && (raw[key] as string).length > 0 ? (raw[key] as string) : null;
}

/**
 * Parses one Prompt 2 response into a finalised-shape {@link CodeUnit} (fingerprint empty).
 *
 * @param raw - The untrusted Prompt 2 JSON object.
 * @param descriptor - The trusted Stage-1 descriptor supplying identity, kind, and span.
 * @param fileId - The source `FileNode` id stamped onto the unit.
 * @returns A fully-narrowed `CodeUnit` with `semanticFingerprint === ""`.
 */
export function parseCodeUnit(raw: Record<string, unknown>, descriptor: UnitDescriptor, fileId: string): CodeUnit {
  return {
    unitId: descriptor.unitId,
    fileId,
    unitKind: descriptor.unitKind,
    name: descriptor.name,
    qualifiedName: descriptor.qualifiedName,
    parentUnitId: descriptor.parentUnitId,
    startLine: descriptor.startLine,
    endLine: descriptor.endLine,
    signature: optString(raw, "signature"),
    parameters: parseParameters(raw["parameters"]),
    returnType: optString(raw, "return_type"),
    decorators: pickStringArray(raw["decorators"]),
    modifiersApplied: pickStringArray(raw["modifiers_applied"]),
    mutability: optString(raw, "mutability"),
    visibility: optString(raw, "visibility"),
    isAsync: pickBool(raw["is_async"]),
    isGenerator: pickBool(raw["is_generator"]),
    isAbstract: pickBool(raw["is_abstract"]),
    isStatic: pickBool(raw["is_static"]),
    genericTypeParams: pickStringArray(raw["generic_type_params"]),
    logicOutline: parseLogicOutline(raw["logic_outline"]),
    preconditions: pickStringArray(raw["preconditions"]),
    postconditions: pickStringArray(raw["postconditions"]),
    invariants: pickStringArray(raw["invariants"]),
    edgeCases: pickStringArray(raw["edge_cases"]),
    tieBreakingRules: pickStringArray(raw["tie_breaking_rules"]),
    errorPolicy: parseErrorPolicy(raw["error_policy"]),
    stateMutations: pickStringArray(raw["state_mutations"]),
    eventsEmitted: pickStringArray(raw["events_emitted"]),
    complexity: optString(raw, "complexity"),
    calls: parseCalls(raw["calls"]),
    symbolReferences: pickStringArray(raw["symbol_references"]),
    baseTypes: pickStringArray(raw["base_types"]),
    implementsTypes: pickStringArray(raw["implements"]),
    members: parseMembers(raw["members"]),
    memberUnitIds: pickStringArray(raw["member_unit_ids"]),
    constants: parseNamedConstants(raw["constants"]),
    ioFormatSpec: optString(raw, "io_format_spec"),
    verbatimBlocks: parseVerbatimBlocks(raw["verbatim_blocks"]),
    exampleIoPairs: parseExampleIoPairs(raw["example_io_pairs"]),
    testReferences: pickStringArray(raw["test_references"]),
    semanticFingerprint: "",
  };
}
