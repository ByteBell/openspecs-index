/**
 * Per-file structural node bags — publicSignatures, typeShapes, sectionMap,
 * fileConstants, moduleLayout. Each is keyed by `(knowledgeId, fileId, …)` in
 * Neo4j because its meaning is tied to position within this file.
 */

export interface IrPublicSignatureBag {
  kind: string;
  name: string;
  signature: string;
  generics: string | null;
  decorators: string[];
  returnType: string | null;
  exported: boolean;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrTypeShapeBag {
  kind: string;
  name: string;
  shape: string;
  discriminant: string | null;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrSectionBag {
  order: number;
  name: string;
  intent: string;
  structureKind: string;
  predicate: string | null;
  branchOutcomes: string[];
  bounds: string | null;
  terminationCondition: string | null;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrFileConstantBag {
  name: string | null;
  value: string;
  kind: string;
}

export interface IrModuleLayoutBag {
  order: number;
  label: string;
}

export interface IrFileStructuralNodes {
  publicSignatures: IrPublicSignatureBag[];
  typeShapes: IrTypeShapeBag[];
  sections: IrSectionBag[];
  fileConstants: IrFileConstantBag[];
  moduleLayout: IrModuleLayoutBag[];
}
