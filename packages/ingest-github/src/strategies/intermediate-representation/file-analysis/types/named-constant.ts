/**
 * A literal preserved verbatim — used at the file level (`ModuleIr.fileConstants`) and at the
 * unit level (`CodeUnit.constants`). Lives in file-analysis because file-analysis emits the
 * file-level constants list and is the lower half of the IR strategy; reconstruction imports
 * this type from here so the dep direction stays downward.
 */
export interface UnitConstant {
  name: string | null;
  value: string;
  kind: string;
}
