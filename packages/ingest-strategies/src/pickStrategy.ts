import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import type { IngestStrategy, ProgressContextFactory } from "@bb/ingest-core";
import { createFlatFolderStrategy } from "#src/flat-folder/index.ts";
import { createConceptGraphStrategy } from "#src/concept-graph/index.ts";

export interface PickStrategyDeps {
  fileAnalyzer: Parameters<typeof createFlatFolderStrategy>[0]["fileAnalyzer"];
  progressContextFactory: ProgressContextFactory;
}

/**
 * Resolves the active public ingestion strategy from `Config.IngestionStrategy`.
 * Defaults to flat-folder when the config value is unset or unrecognised
 * (with a warning so the operator knows their typo silently fell back).
 *
 * The private `intermediate-representation` strategy is NOT handled here — it
 * lives in `@bytebell/ingest-strategies` and is selected by the enterprise
 * composition root before falling back to this picker.
 */
export function pickStrategy(deps: PickStrategyDeps): IngestStrategy {
  const selected = getConfigValue(Config.IngestionStrategy);
  switch (selected) {
    case "concept-graph":
      logger.info("ingest-strategies: active strategy = concept-graph");
      return createConceptGraphStrategy({
        fileAnalyzer: deps.fileAnalyzer,
        progressContextFactory: deps.progressContextFactory,
      });
    case "flat-folder":
      logger.info("ingest-strategies: active strategy = flat-folder");
      return createFlatFolderStrategy({
        fileAnalyzer: deps.fileAnalyzer,
        progressContextFactory: deps.progressContextFactory,
      });
    default:
      logger.warn(
        `ingest-strategies: Config.IngestionStrategy="${selected}" unrecognised; falling back to flat-folder`,
      );
      return createFlatFolderStrategy({
        fileAnalyzer: deps.fileAnalyzer,
        progressContextFactory: deps.progressContextFactory,
      });
  }
}
