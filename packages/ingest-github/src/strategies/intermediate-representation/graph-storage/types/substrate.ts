/**
 * Global substrate-by-content-hash bags. Each item carries a `hash` field that
 * is the MERGE key for the global node; the `anchorStart`/`anchorEnd` (and any
 * positional modifiers) live on the edge from the parent.
 */

export interface IrVerbatimLiteralBag {
  kind: string;
  hash: string;
  value: string;
  context: string | null;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrSideEffectBag {
  category: string;
  value: string;
}

export interface IrEdgeCaseBag {
  hash: string;
  inputShape: string;
  behavior: string;
  handled: boolean;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrBoundaryConditionBag {
  hash: string;
  operator: string;
  left: string;
  right: string;
  inclusive: boolean;
  intent: string;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrErrorHandlingBag {
  hash: string;
  thrown: string | null;
  caught: string | null;
  action: string;
  fallback: string | null;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrInvariantBag {
  hash: string;
  kind: string;
  description: string;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrDiagnosticNoteBag {
  hash: string;
  category: string;
  description: string;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrAssumptionBag {
  hash: string;
  kind: string;
  description: string;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrAmbiguityBag {
  hash: string;
  question: string;
  affects: string;
  resolution: string | null;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrSubstrateNodes {
  verbatimLiterals: IrVerbatimLiteralBag[];
  sideEffects: IrSideEffectBag[];
  edgeCases: IrEdgeCaseBag[];
  boundaryConditions: IrBoundaryConditionBag[];
  errorHandling: IrErrorHandlingBag[];
  invariants: IrInvariantBag[];
  diagnosticNotes: IrDiagnosticNoteBag[];
  assumptions: IrAssumptionBag[];
  ambiguities: IrAmbiguityBag[];
}
