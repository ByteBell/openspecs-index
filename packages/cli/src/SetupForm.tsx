import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { KEY_MAP } from "./keyMap.ts";
import { Field } from "./Field.tsx";
import { ensureGlobalLink } from "./globalLink.ts";

interface Row {
  id: string;
  label: string;
  cliKey: string;
  mask?: boolean;
  validate: (raw: string) => string | null;
}

const MONGO_RX = /^mongodb(\+srv)?:\/\//u;
const NEO4J_RX = /^(bolt|neo4j)(\+s|\+ssc)?:\/\//u;
const REDIS_RX = /^rediss?:\/\//u;

const ROWS: Row[] = [
  {
    id: "mongo",
    label: "Mongo URI",
    cliKey: "mongo",
    validate: (s) => (MONGO_RX.test(s) ? null : "expected mongodb:// or mongodb+srv://"),
  },
  {
    id: "neo4j",
    label: "Neo4j URI",
    cliKey: "neo4j",
    validate: (s) => (NEO4J_RX.test(s) ? null : "expected bolt:// or neo4j://"),
  },
  { id: "neo4j-user", label: "Neo4j user", cliKey: "neo4j-user", validate: (s) => (s.length > 0 ? null : "required") },
  {
    id: "neo4j-password",
    label: "Neo4j password",
    cliKey: "neo4j-password",
    mask: true,
    validate: (s) => (s.length > 0 ? null : "required"),
  },
  {
    id: "redis",
    label: "Redis URL",
    cliKey: "redis",
    validate: (s) => (REDIS_RX.test(s) ? null : "expected redis:// or rediss://"),
  },
  {
    id: "port",
    label: "Server port",
    cliKey: "port",
    validate: (s) => (/^\d+$/u.test(s) && Number(s) > 0 && Number(s) <= 65535 ? null : "expected integer 1-65535"),
  },
  {
    id: "concurrency-github",
    label: "GitHub Concurrency",
    cliKey: "concurrency.github",
    validate: (s) => (/^\d+$/u.test(s) && Number(s) > 0 ? null : "expected positive integer"),
  },
];

function loadInitial(): Record<string, string> {
  return {
    mongo: getConfigValue(Config.MongoUri),
    neo4j: getConfigValue(Config.Neo4jUri),
    "neo4j-user": getConfigValue(Config.Neo4jUser),
    "neo4j-password": getConfigValue(Config.Neo4jPassword),
    redis: getConfigValue(Config.RedisUrl),
    port: String(getConfigValue(Config.ServerPort)),
    "concurrency-github": String(getConfigValue(Config.ConcurrencyGithub)),
  };
}

export interface SetupFormProps {
  onDone: (result: { saved: boolean; error?: string }) => void;
}

export function SetupForm({ onDone }: SetupFormProps): ReactElement {
  const { exit } = useApp();
  const [values, setValues] = useState<Record<string, string>>(() => loadInitial());
  const [submitError, setSubmitError] = useState<string | null>(null);

  const errors: Record<string, string | null> = {};
  for (const row of ROWS) {
    errors[row.id] = row.validate(values[row.id] ?? "");
  }
  const allValid = ROWS.every((r) => errors[r.id] === null);

  useInput((_input, key) => {
    if (key.escape) {
      exit();
      onDone({ saved: false });
      return;
    }
    if (key.return && allValid && submitError === null) {
      try {
        for (const row of ROWS) {
          const entry = KEY_MAP[row.cliKey];
          if (entry === undefined) {
            throw new Error(`No KEY_MAP entry for "${row.cliKey}"`);
          }
          entry.setter(values[row.id] ?? "");
        }
        ensureGlobalLink();
        exit();
        onDone({ saved: true });
      } catch (cause: unknown) {
        setSubmitError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Bytebell setup</Text>
      </Box>
      {ROWS.map((row) => (
        <Field
          key={row.id}
          id={row.id}
          label={row.label}
          value={values[row.id] ?? ""}
          onChange={(next) => setValues((prev) => ({ ...prev, [row.id]: next }))}
          {...(row.mask === true ? { mask: true } : {})}
          {...(errors[row.id] !== null ? { error: errors[row.id] ?? "" } : {})}
        />
      ))}
      <Box marginTop={1}>
        <Text dimColor>[Tab] next [Shift-Tab] back [Enter] save [Esc] quit</Text>
      </Box>
      {submitError !== null && (
        <Box marginTop={1}>
          <Text color="red">save failed: {submitError}</Text>
        </Box>
      )}
    </Box>
  );
}
