import path from "node:path";
import { Config } from "@bb/types";
import { getBytebellHome, getConfigValue } from "@bb/config";
import { knowledgeDb } from "@bb/db";
import { LayoutMigrationRequiredError } from "@bb/errors";
import { hasLegacyLayout, migrateLegacyPaths } from "@bb/path-migration";

// ─────────────────────────────────────────────────────────────────────────────
// Boot-time reconciliation of the legacy on-disk layout. Runs AFTER the DB is
// connected, since it needs the knowledge list to decide what is recoverable.
//
//   1. Migrate every knowledge with a DB record into the commit-scoped layout.
//   2. Delete legacy dirs with no DB record (orphans) and log them as abandoned.
//   3. Refuse to boot only if legacy dirs remain that DO back a live knowledge
//      but could not be migrated (missing commitId / repoUrl). Those carry data
//      we must not silently destroy; the operator resolves them by hand.
//
// Safety guard: if the knowledge DB is EMPTY but legacy dirs exist, we refuse to
// boot instead of treating every dir as an orphan and deleting it. An empty DB
// alongside on-disk repos is ambiguous — it can be a deliberate reset, but it is
// also exactly what a misconfigured / switched provider looks like (an upgrade
// that flipped the active db/graph provider leaves the real records in the
// previous store, unreachable rather than gone). Auto-deleting there would
// destroy data. The operator opts into pruning explicitly via `bytebell migrate
// paths`.
// ─────────────────────────────────────────────────────────────────────────────

export async function reconcileLegacyLayout(): Promise<void> {
  const home = getBytebellHome();
  if (!(await hasLegacyLayout(home))) {
    return;
  }

  const orgId = getConfigValue(Config.OrgId);
  const knowledgeDocs = await knowledgeDb.listKnowledge({ limit: 100_000 });
  if (knowledgeDocs.length === 0) {
    throw new LayoutMigrationRequiredError(path.join(home, "repos", ".meta"));
  }
  const summary = await migrateLegacyPaths({ home, orgId, knowledgeDocs, dryRun: false });

  for (const moved of summary.migrated) {
    process.stdout.write(`legacy-layout migrated: ${moved}\n`);
  }
  for (const id of summary.abandoned) {
    process.stderr.write(`legacy-layout abandoned (no DB record; removed from disk): ${id}\n`);
  }
  for (const f of summary.failed) {
    process.stderr.write(`legacy-layout migration failed for ${f.knowledgeId}: ${f.reason}\n`);
  }

  // Anything still under `repos/.meta` now belongs to a live DB record that
  // could not be migrated. Refuse rather than delete a live knowledge's data.
  if (await hasLegacyLayout(home)) {
    throw new LayoutMigrationRequiredError(path.join(home, "repos", ".meta"));
  }
}
