/**
 * Builds the stable `unit_id` for a code unit: `{file_node_id}#{unit_kind}:{qualified_name}`.
 * Used to fall back when the splitter omits or malforms the id it was asked to emit.
 */

/**
 * Composes a stable unit id from its parts.
 *
 * @param fileNodeId - The source `FileNode.node_id`.
 * @param unitKind - The unit's kind (open vocabulary).
 * @param qualifiedName - The parent-qualified name.
 * @returns The id `{fileNodeId}#{unitKind}:{qualifiedName}`.
 */
export function buildUnitId(fileNodeId: string, unitKind: string, qualifiedName: string): string {
  return `${fileNodeId}#${unitKind}:${qualifiedName}`;
}
