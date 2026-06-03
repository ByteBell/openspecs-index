/**
 * Builds the stable `unit_id` for a code unit and the per-unit `fileId` it carries.
 *
 * Format: the per-unit `fileId` is the file's node id with the unit's qualified name appended
 * after `__`; `unitId` then suffixes the canonical `#{unitKind}:{qualifiedName}`. This places
 * the code unit's name at the end of both `fileId` and `unitId` and keeps every per-unit
 * record self-identifying without a model-slug prefix.
 *
 *   unitFileId = `${fileNodeId}__${qualifiedName}`
 *   unitId     = `${unitFileId}#${unitKind}:${qualifiedName}`
 *
 * `fileNodeId` itself is just the file's relative path (or `<rel>:chunk-N` for chunked
 * sources) — no model / knowledge prefix.
 */

/** Builds the per-unit file id (file node id + unit name). */
export function buildUnitFileId(fileNodeId: string, qualifiedName: string): string {
  return `${fileNodeId}__${qualifiedName}`;
}

/**
 * Composes a stable unit id from its parts.
 *
 * @param fileNodeId - The source `FileNode.node_id` (already model-free).
 * @param unitKind - The unit's kind (open vocabulary).
 * @param qualifiedName - The parent-qualified name.
 * @returns The id `${fileNodeId}__${qualifiedName}#${unitKind}:${qualifiedName}`.
 */
export function buildUnitId(fileNodeId: string, unitKind: string, qualifiedName: string): string {
  return `${buildUnitFileId(fileNodeId, qualifiedName)}#${unitKind}:${qualifiedName}`;
}

/** Strips the `#kind:qn` suffix from a unit id, returning the per-unit `fileId`. */
export function unitFileIdOf(unitId: string): string {
  const hash = unitId.indexOf("#");
  return hash >= 0 ? unitId.slice(0, hash) : unitId;
}
