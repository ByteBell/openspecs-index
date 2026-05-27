export async function ensureFlatFolderIndexes(): Promise<void> {
  // LadybugDB implements uniqueness natively via PRIMARY KEY constraints defined during schema creation.
  // Full-text indexes are not supported via Cypher index syntax in LadybugDB; standard MATCH scans are used instead.
  return Promise.resolve();
}
