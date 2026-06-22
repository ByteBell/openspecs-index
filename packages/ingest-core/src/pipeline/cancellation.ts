import { CancellationError } from "@bb/errors";

export { CancellationError };

const cancelled = new Set<string>();

export function markCancelled(knowledgeId: string): void {
  cancelled.add(knowledgeId);
}

export function clearCancellation(knowledgeId: string): void {
  cancelled.delete(knowledgeId);
}

export function isCancelled(knowledgeId: string): boolean {
  return cancelled.has(knowledgeId);
}

export function throwIfCancelled(knowledgeId: string): void {
  if (cancelled.has(knowledgeId)) {
    throw new CancellationError(knowledgeId);
  }
}
