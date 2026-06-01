import type { ModuleIr } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import { contentHash } from "#src/strategies/intermediate-representation/graph-storage/hashing.ts";
import type {
  IrAmbiguityBag,
  IrAssumptionBag,
  IrBoundaryConditionBag,
  IrDiagnosticNoteBag,
  IrEdgeCaseBag,
  IrErrorHandlingBag,
  IrInvariantBag,
  IrSideEffectBag,
  IrSubstrateNodes,
  IrVerbatimLiteralBag,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Projects every nested SemanticFields list whose elements describe *content*
 * (an invariant, an edge case, a literal, a side effect, …) into substrate
 * node bags. Each bag carries a content-hash key, so identical content from
 * different files MERGEs to one shared node downstream.
 *
 * The anchor lines stay on the edge (in the writer), not on the node — the
 * node is the content; the edge is "this file mentions/has it here".
 */
export function projectSubstrate(m: ModuleIr): IrSubstrateNodes {
  return {
    verbatimLiterals: m.verbatimLiterals.map(projectVerbatimLiteral),
    sideEffects: projectSideEffects(m.sideEffects),
    edgeCases: m.edgeCases.map(projectEdgeCase),
    boundaryConditions: m.boundaryConditions.map(projectBoundaryCondition),
    errorHandling: m.errorHandling.map(projectErrorHandling),
    invariants: m.invariants.map(projectInvariant),
    diagnosticNotes: m.diagnosticNotes.map(projectDiagnosticNote),
    assumptions: m.assumptions.map(projectAssumption),
    ambiguities: m.ambiguities.map(projectAmbiguity),
  };
}

function projectVerbatimLiteral(v: ModuleIr["verbatimLiterals"][number]): IrVerbatimLiteralBag {
  return {
    kind: v.kind,
    hash: contentHash("verbatim", v.kind, v.value),
    value: v.value,
    context: v.context,
    anchorStart: v.anchor.startLine,
    anchorEnd: v.anchor.endLine,
  };
}

function projectSideEffects(se: ModuleIr["sideEffects"]): IrSideEffectBag[] {
  const out: IrSideEffectBag[] = [];
  for (const [category, values] of Object.entries(se)) {
    for (const value of values) {
      if (value.length === 0) continue;
      out.push({ category, value });
    }
  }
  return out;
}

function projectEdgeCase(e: ModuleIr["edgeCases"][number]): IrEdgeCaseBag {
  return {
    hash: contentHash("edge-case", e.inputShape, e.behavior),
    inputShape: e.inputShape,
    behavior: e.behavior,
    handled: e.handled,
    anchorStart: e.anchor.startLine,
    anchorEnd: e.anchor.endLine,
  };
}

function projectBoundaryCondition(b: ModuleIr["boundaryConditions"][number]): IrBoundaryConditionBag {
  return {
    hash: contentHash("boundary", b.operator, b.left, b.right, b.inclusive, b.intent),
    operator: b.operator,
    left: b.left,
    right: b.right,
    inclusive: b.inclusive,
    intent: b.intent,
    anchorStart: b.anchor.startLine,
    anchorEnd: b.anchor.endLine,
  };
}

function projectErrorHandling(e: ModuleIr["errorHandling"][number]): IrErrorHandlingBag {
  return {
    hash: contentHash("error-handling", e.thrown, e.caught, e.action, e.fallback),
    thrown: e.thrown,
    caught: e.caught,
    action: e.action,
    fallback: e.fallback,
    anchorStart: e.anchor.startLine,
    anchorEnd: e.anchor.endLine,
  };
}

function projectInvariant(i: ModuleIr["invariants"][number]): IrInvariantBag {
  return {
    hash: contentHash("invariant", i.kind, i.description),
    kind: i.kind,
    description: i.description,
    anchorStart: i.anchor.startLine,
    anchorEnd: i.anchor.endLine,
  };
}

function projectDiagnosticNote(d: ModuleIr["diagnosticNotes"][number]): IrDiagnosticNoteBag {
  return {
    hash: contentHash("diagnostic", d.category, d.description),
    category: d.category,
    description: d.description,
    anchorStart: d.anchor.startLine,
    anchorEnd: d.anchor.endLine,
  };
}

function projectAssumption(a: ModuleIr["assumptions"][number]): IrAssumptionBag {
  return {
    hash: contentHash("assumption", a.kind, a.description),
    kind: a.kind,
    description: a.description,
    anchorStart: a.anchor.startLine,
    anchorEnd: a.anchor.endLine,
  };
}

function projectAmbiguity(a: ModuleIr["ambiguities"][number]): IrAmbiguityBag {
  return {
    hash: contentHash("ambiguity", a.question, a.affects),
    question: a.question,
    affects: a.affects,
    resolution: a.resolution,
    anchorStart: a.anchor.startLine,
    anchorEnd: a.anchor.endLine,
  };
}
