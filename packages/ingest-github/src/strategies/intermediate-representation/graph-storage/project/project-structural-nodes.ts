import type { ModuleIr } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type {
  IrFileConstantBag,
  IrFileStructuralNodes,
  IrModuleLayoutBag,
  IrPublicSignatureBag,
  IrSectionBag,
  IrTypeShapeBag,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Projects the per-file *structural* lists — `publicSignatures`, `typeShapes`,
 * `sectionMap`, `fileConstants`, `moduleLayout` — into their own node bags.
 * These are keyed by `(knowledgeId, fileId, …)` because their meaning is tied
 * to position in this specific file: two files with a `:Section` called
 * "imports" are not the same section.
 */
export function projectStructuralNodes(m: ModuleIr): IrFileStructuralNodes {
  return {
    publicSignatures: m.publicSignatures.map(projectPublicSignature),
    typeShapes: m.typeShapes.map(projectTypeShape),
    sections: m.sectionMap.map(projectSection),
    fileConstants: m.fileConstants.map(projectFileConstant),
    moduleLayout: m.moduleLayout.map(projectModuleLayout),
  };
}

function projectPublicSignature(p: ModuleIr["publicSignatures"][number]): IrPublicSignatureBag {
  return {
    kind: p.kind,
    name: p.name,
    signature: p.signature,
    generics: p.generics,
    decorators: p.decorators,
    returnType: p.returnType,
    exported: p.exported,
    anchorStart: p.anchor.startLine,
    anchorEnd: p.anchor.endLine,
  };
}

function projectTypeShape(t: ModuleIr["typeShapes"][number]): IrTypeShapeBag {
  return {
    kind: t.kind,
    name: t.name,
    shape: t.shape,
    discriminant: t.discriminant,
    anchorStart: t.anchor.startLine,
    anchorEnd: t.anchor.endLine,
  };
}

function projectSection(s: ModuleIr["sectionMap"][number], order: number): IrSectionBag {
  return {
    order,
    name: s.name,
    intent: s.intent,
    structureKind: s.structureKind,
    predicate: s.predicate,
    branchOutcomes: s.branchOutcomes,
    bounds: s.bounds,
    terminationCondition: s.terminationCondition,
    anchorStart: s.anchor.startLine,
    anchorEnd: s.anchor.endLine,
  };
}

function projectFileConstant(c: ModuleIr["fileConstants"][number]): IrFileConstantBag {
  return {
    name: c.name,
    value: c.value,
    kind: c.kind,
  };
}

function projectModuleLayout(label: string, order: number): IrModuleLayoutBag {
  return { order, label };
}
