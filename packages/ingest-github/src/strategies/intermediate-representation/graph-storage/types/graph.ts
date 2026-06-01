/**
 * State-model bags and per-file call/data-flow edge bags. The call/flow edges
 * MERGE between `:CodeUnit` qualified-name endpoints with `:UnresolvedCallee`
 * fallback when the callee/consumer isn't a known unit in this knowledge.
 */

export interface IrStateBag {
  name: string;
  initial: boolean;
  terminal: boolean;
}

export interface IrStateTransitionBag {
  fromState: string;
  toState: string;
  trigger: string;
  guard: string | null;
  effect: string | null;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrStateModelBag {
  states: IrStateBag[];
  transitions: IrStateTransitionBag[];
}

export interface IrCallEdgeBag {
  caller: string;
  callee: string;
  origin: string;
  kind: string;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrFlowEdgeBag {
  producer: string;
  consumer: string;
  payload: string;
  transformation: string | null;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrUnitGraphEdges {
  calls: IrCallEdgeBag[];
  flows: IrFlowEdgeBag[];
}
