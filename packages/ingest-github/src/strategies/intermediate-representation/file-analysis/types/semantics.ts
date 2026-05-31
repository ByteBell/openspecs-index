/**
 * The IR strategy's file-level fields. Flattened into a shared base so they become DIRECT
 * members of every node that extends it (`ModuleIr`, and downstream the per-chunk record) —
 * not a nested `FileAnalysis` object.
 *
 * This shape is **decoupled** from `@bb/mongo`'s `FileAnalysis` (the flat-folder shape).
 * Reshaped + new v2 fields would not round-trip through `FileAnalysis`, so the IR strategy
 * owns its own surface here.
 *
 * Field groups:
 *
 * - **v1 carryovers** (unchanged from flat-folder's analysis): purpose, summary, businessContext,
 *   keywords, ontologyConcepts, businessEntities, systemCapabilities, configDependencies,
 *   classes, functions.
 * - **Reshapes**: sectionMap, sideEffects, integrationSurface, importsInternal, importsExternal,
 *   contractsProvided, contractsConsumed.
 * - **New v2 substrate**: representationFamily, representationType, publicSignatures, typeShapes,
 *   localCallGraph, dataFlowGraph, verbatimLiterals, canonicalCentroid.
 * - **Error-aware**: edgeCases, boundaryConditions, errorHandling, invariants, diagnosticNotes.
 * - **Orchestration**: assumptions, ambiguities, concurrencyModel, stateModel.
 * - **Shape + compression**: fileFingerprint, reconstructionHints.
 * - **Dropped from v1**: dataFlowDirection (replaced by `dataFlowGraph`).
 */
import type {
  CanonicalCentroid,
  ContractDescriptor,
  DataFlowEdge,
  ExternalImport,
  InternalImport,
  LocalCallEdge,
  PublicSignature,
  RepresentationFamily,
  TypeShape,
  VerbatimLiteral,
} from "./v2/substrate.ts";
import type {
  BoundaryCondition,
  DiagnosticNote,
  EdgeCase,
  ErrorHandlingItem,
  Invariant,
} from "./v2/error-aware.ts";
import type {
  Ambiguity,
  Assumption,
  ConcurrencyModel,
  StateModel,
} from "./v2/orchestration.ts";
import type {
  FileFingerprint,
  ReconstructionHints,
  SectionMapEntry,
  SideEffects,
} from "./v2/shape.ts";

export interface SemanticFields {
  // ---- v1 carryovers --------------------------------------------------------
  purpose: string;
  summary: string;
  businessContext: string;
  classes: string[];
  functions: string[];
  keywords: string[];
  ontologyConcepts: string[];
  businessEntities: string[];
  systemCapabilities: string[];
  configDependencies: string[];

  // ---- reshapes -------------------------------------------------------------
  /** Structured cross-file references. `resolvedRelativePath` / `resolvedFileId` are filled by mcp-enrichment. */
  importsInternal: InternalImport[];
  /** Structured third-party / stdlib references. */
  importsExternal: ExternalImport[];
  /** Categorized observable effects. */
  sideEffects: SideEffects;
  /** Channel-prefixed entries (`api_call:` / `event_pub:` / `event_sub:` / `table_read:` / `table_write:` / `grpc:` / `queue:` / `shared_schema:` / `ws:` / ...). */
  integrationSurface: string[];
  /** Public contracts this file exposes. `resolvedRelativePath` / `resolvedFileId` are filled by mcp-enrichment. */
  contractsProvided: ContractDescriptor[];
  /** Public contracts this file depends on. `resolvedRelativePath` / `resolvedFileId` are filled by mcp-enrichment. */
  contractsConsumed: ContractDescriptor[];
  /** Reshaped — entries describe intent + structureKind + (when applicable) predicate / bounds, not free prose. */
  sectionMap: SectionMapEntry[];

  // ---- reconstruction substrate (new) --------------------------------------
  representationFamily: RepresentationFamily;
  representationType: string;
  publicSignatures: PublicSignature[];
  typeShapes: TypeShape[];
  localCallGraph: LocalCallEdge[];
  dataFlowGraph: DataFlowEdge[];
  verbatimLiterals: VerbatimLiteral[];
  canonicalCentroid: CanonicalCentroid;

  // ---- error-aware (new) ---------------------------------------------------
  edgeCases: EdgeCase[];
  boundaryConditions: BoundaryCondition[];
  errorHandling: ErrorHandlingItem[];
  invariants: Invariant[];
  diagnosticNotes: DiagnosticNote[];

  // ---- orchestration (new) -------------------------------------------------
  assumptions: Assumption[];
  /** TBDs the analyzer was unsure about — cleared by mcp-enrichment (pass-2). */
  ambiguities: Ambiguity[];
  concurrencyModel: ConcurrencyModel;
  /** Populated only when `representationFamily === "state-machine"`. */
  stateModel: StateModel | null;

  // ---- shape + compression (new) -------------------------------------------
  fileFingerprint: FileFingerprint;
  reconstructionHints: ReconstructionHints;
}
