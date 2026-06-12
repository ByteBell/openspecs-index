#!/usr/bin/env bun
import { buildProgram } from "./program.ts";
import { error } from "./output.ts";

async function main(): Promise<void> {
  const program = buildProgram();
  program.name("bytebell");
  await program.parseAsync(process.argv);
}

main().catch((cause: unknown) => {
  const msg = cause instanceof Error ? cause.message : String(cause);
  error(msg);
  process.exit(2);
});
