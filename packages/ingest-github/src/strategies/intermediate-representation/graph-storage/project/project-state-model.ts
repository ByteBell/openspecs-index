import type { ModuleIr } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type {
  IrStateBag,
  IrStateModelBag,
  IrStateTransitionBag,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Projects the `ModuleIr.stateModel` (when non-null) into a state-graph bag.
 * The downstream writer creates one `:StateModel` keyed by `(knowledgeId, fileId)`,
 * one `:State` per distinct state name (per-file), and one `:TRANSITIONS_TO` edge
 * per transition.
 *
 * Returns `null` when the file has no state model — the writer no-ops on null.
 */
export function projectStateModel(m: ModuleIr): IrStateModelBag | null {
  const sm = m.stateModel;
  if (sm === null) return null;
  const finalSet = new Set(sm.finalStates);
  const initial = sm.initialState;
  const states: IrStateBag[] = sm.states.map((name) => ({
    name,
    initial: name === initial,
    terminal: finalSet.has(name),
  }));
  const transitions: IrStateTransitionBag[] = sm.transitions.map((t) => ({
    fromState: t.from,
    toState: t.to,
    trigger: t.trigger,
    guard: t.guard,
    effect: t.effect,
    anchorStart: t.anchor.startLine,
    anchorEnd: t.anchor.endLine,
  }));
  return { states, transitions };
}
