import { Connection } from "@ladybugdb/core";

// Schema bootstrap for the LadybugDB graph: node + rel table DDL plus the
// idempotent `ensureSchema` runner. Split out of `client.ts` to keep the
// connection module under the Rule of File Size; `ensureSchema` is internal
// and only called from `doConnect`.

const nodeTables = [
  `CREATE NODE TABLE Knowledge (
    knowledgeId STRING PRIMARY KEY,
    createdAt STRING,
    sourceKind STRING,
    sourceUrl STRING,
    branch STRING,
    repoName STRING,
    state STRING,
    updatedAt STRING
  )`,
  `CREATE NODE TABLE Repo (
    id STRING PRIMARY KEY,
    orgId STRING,
    knowledgeId STRING,
    repoId STRING,
    repoUrl STRING,
    branch STRING,
    purpose STRING,
    summary STRING,
    architecture STRING,
    dataFlow STRING,
    majorSubsystems STRING[],
    keyPatterns STRING[],
    updatedAt STRING
  )`,
  `CREATE NODE TABLE Folder (
    id STRING PRIMARY KEY,
    orgId STRING,
    knowledgeId STRING,
    repoId STRING,
    folderPath STRING,
    purpose STRING,
    summary STRING,
    dependencyGraph STRING,
    updatedAt STRING
  )`,
  `CREATE NODE TABLE File (
    id STRING PRIMARY KEY,
    orgId STRING,
    knowledgeId STRING,
    repoId STRING,
    relativePath STRING,
    language STRING,
    sha STRING,
    sizeBytes INT64,
    purpose STRING,
    summary STRING,
    businessContext STRING,
    dataFlowDirection STRING,
    ontologyConcepts STRING[],
    businessEntities STRING[],
    systemCapabilities STRING[],
    sideEffects STRING[],
    configDependencies STRING[],
    integrationSurface STRING[],
    contractsProvided STRING[],
    contractsConsumed STRING[],
    sectionNames STRING[],
    sectionDescriptions STRING[],
    isBigFile BOOLEAN,
    totalChunks INT64,
    totalTokenCount INT64,
    updatedAt STRING
  )`,
  `CREATE NODE TABLE FileVersion (
    id STRING PRIMARY KEY,
    knowledgeId STRING,
    relativePath STRING,
    commitHash STRING,
    language STRING,
    sha STRING,
    sizeBytes INT64,
    purpose STRING,
    summary STRING,
    businessContext STRING,
    dataFlowDirection STRING,
    ontologyConcepts STRING[],
    businessEntities STRING[],
    systemCapabilities STRING[],
    sideEffects STRING[],
    configDependencies STRING[],
    integrationSurface STRING[],
    contractsProvided STRING[],
    contractsConsumed STRING[],
    sectionNames STRING[],
    sectionDescriptions STRING[],
    snapshotAt STRING
  )`,
  `CREATE NODE TABLE Keyword (
    name STRING PRIMARY KEY
  )`,
  `CREATE NODE TABLE Class (
    signature STRING PRIMARY KEY
  )`,
  `CREATE NODE TABLE Function (
    signature STRING PRIMARY KEY
  )`,
  `CREATE NODE TABLE Module (
    name STRING PRIMARY KEY
  )`,
  `CREATE NODE TABLE Concept (
    id STRING PRIMARY KEY,
    orgId STRING,
    knowledgeId STRING,
    slug STRING,
    kind STRING,
    name STRING,
    rationale STRING,
    enrichmentRunId STRING,
    createdAt STRING,
    updatedAt STRING
  )`,
  `CREATE NODE TABLE Contract (
    id STRING PRIMARY KEY,
    orgId STRING,
    knowledgeId STRING,
    slug STRING,
    kind STRING,
    name STRING,
    enrichmentRunId STRING,
    createdAt STRING,
    updatedAt STRING
  )`,
  `CREATE NODE TABLE Guidepost (
    id STRING PRIMARY KEY,
    orgId STRING,
    knowledgeId STRING,
    slug STRING,
    kind STRING,
    note STRING,
    area STRING,
    enrichmentRunId STRING,
    createdAt STRING,
    updatedAt STRING
  )`,
];

const relTables = [
  `CREATE REL TABLE HAS_REPO (FROM Knowledge TO Repo)`,
  `CREATE REL TABLE HAS_FILE (FROM Knowledge TO File)`,
  `CREATE REL TABLE CONTAINS (FROM Repo TO Folder, FROM Folder TO Folder, FROM Folder TO File)`,
  `CREATE REL TABLE HAS_KEYWORD (FROM File TO Keyword, FROM Folder TO Keyword, FROM Repo TO Keyword)`,
  `CREATE REL TABLE HAS_CLASS (FROM File TO Class)`,
  `CREATE REL TABLE HAS_FUNCTION (FROM File TO Function)`,
  `CREATE REL TABLE HAS_IMPORT_INTERNAL (FROM File TO Module)`,
  `CREATE REL TABLE HAS_IMPORT_EXTERNAL (FROM File TO Module)`,
  `CREATE REL TABLE HAS_VERSION (FROM File TO FileVersion)`,
  `CREATE REL TABLE HAS_CONCEPT (FROM File TO Concept, enrichmentRunId STRING, createdAt STRING, updatedAt STRING)`,
  `CREATE REL TABLE PLAYS_ROLE (FROM File TO Concept, enrichmentRunId STRING, createdAt STRING, updatedAt STRING)`,
  `CREATE REL TABLE BELONGS_TO_DOMAIN (FROM File TO Concept, enrichmentRunId STRING, createdAt STRING, updatedAt STRING)`,
  `CREATE REL TABLE TESTS (FROM File TO File, enrichmentRunId STRING, createdAt STRING, updatedAt STRING)`,
  `CREATE REL TABLE DEFINES (FROM File TO Contract, enrichmentRunId STRING, createdAt STRING, updatedAt STRING)`,
  `CREATE REL TABLE CONSUMES (FROM File TO Contract, enrichmentRunId STRING, createdAt STRING, updatedAt STRING)`,
  `CREATE REL TABLE ABOUT (FROM Guidepost TO File, FROM Guidepost TO Concept, FROM Guidepost TO Contract, enrichmentRunId STRING, createdAt STRING, updatedAt STRING)`,
];

export async function ensureSchema(c: Connection): Promise<void> {
  for (const q of [...nodeTables, ...relTables]) {
    try {
      await c.query(q);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        !msg.includes("already exists") &&
        !msg.includes("table already exists") &&
        !msg.includes("Binder exception")
      ) {
        throw e;
      }
    }
  }
}
