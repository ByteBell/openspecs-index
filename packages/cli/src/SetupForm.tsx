import { useState } from "react";
import type { ReactElement } from "react";
import path from "node:path";
import { Box, Text, useApp, useInput } from "ink";
import { Config } from "@bb/types";
import { getConfigValue, getBytebellHome } from "@bb/config";
import { KEY_MAP } from "./keyMap.ts";
import { applyInfraMode, infraModeOption, isEmbedded, type InfraMode } from "./infraMode.ts";
import { Field } from "./Field.tsx";
import { ToggleField } from "./ToggleField.tsx";

const MODE_OPTIONS: readonly [string, string] = ["docker", "embedded"];

interface Row {
  id: string;
  label: string;
  cliKey: string;
  mask?: boolean;
  /** Infra connection rows — only shown in Docker (non-embedded) mode. */
  infra?: boolean;
  /** Local-store rows — only shown in Embedded mode. */
  embedded?: boolean;
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
    infra: true,
    validate: (s) => (MONGO_RX.test(s) ? null : "expected mongodb:// or mongodb+srv://"),
  },
  {
    id: "neo4j",
    label: "Neo4j URI",
    cliKey: "neo4j",
    infra: true,
    validate: (s) => (NEO4J_RX.test(s) ? null : "expected bolt:// or neo4j://"),
  },
  {
    id: "neo4j-user",
    label: "Neo4j user",
    cliKey: "neo4j-user",
    infra: true,
    validate: (s) => (s.length > 0 ? null : "required"),
  },
  {
    id: "neo4j-password",
    label: "Neo4j password",
    cliKey: "neo4j-password",
    mask: true,
    infra: true,
    validate: (s) => (s.length > 0 ? null : "required"),
  },
  {
    id: "redis",
    label: "Redis URL",
    cliKey: "redis",
    infra: true,
    validate: (s) => (REDIS_RX.test(s) ? null : "expected redis:// or rediss://"),
  },
  {
    id: "sqlite-path",
    label: "SQLite path",
    cliKey: "sqlite-path",
    embedded: true,
    validate: (s) => (s.length > 0 ? null : "required"),
  },
  {
    id: "ladybug-path",
    label: "Ladybug path",
    cliKey: "ladybug-path",
    embedded: true,
    validate: (s) => (s.length > 0 ? null : "required"),
  },
  {
    id: "queue-db-path",
    label: "Queue DB path",
    cliKey: "queue-db-path",
    embedded: true,
    validate: (s) => (s.length > 0 ? null : "required"),
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
  {
    id: "openrouter-api-key",
    label: "OpenRouter API key",
    cliKey: "openrouter-api-key",
    mask: true,
    validate: (s) => (s.length > 0 ? null : "required — get one at openrouter.ai/keys"),
  },
  {
    id: "openrouter-model",
    label: "OpenRouter model",
    cliKey: "openrouter-model",
    validate: (s) => (s.length > 0 ? null : "required — e.g. deepseek/deepseek-v4-flash"),
  },
];

/** Embedded store paths fall back to the home-derived default so the field
 * is never blank (matches what `applyInfraMode` would auto-fill). */
function embeddedDefault(key: Config, filename: string): string {
  const current = getConfigValue(key);
  return typeof current === "string" && current.length > 0 ? current : path.join(getBytebellHome(), filename);
}

function loadInitial(): Record<string, string> {
  return {
    mongo: getConfigValue(Config.MongoUri),
    neo4j: getConfigValue(Config.Neo4jUri),
    "neo4j-user": getConfigValue(Config.Neo4jUser),
    "neo4j-password": getConfigValue(Config.Neo4jPassword),
    redis: getConfigValue(Config.RedisUrl),
    "sqlite-path": embeddedDefault(Config.SqlitePath, "data.sqlite"),
    "ladybug-path": embeddedDefault(Config.LadybugPath, "ladybug.lbug"),
    "queue-db-path": embeddedDefault(Config.QueueDbPath, "queue.db"),
    port: String(getConfigValue(Config.ServerPort)),
    "concurrency-github": String(getConfigValue(Config.ConcurrencyGithub)),
    "openrouter-api-key": getConfigValue(Config.OpenrouterApiKey),
    "openrouter-model": getConfigValue(Config.OpenrouterModel),
    "infra-mode": isEmbedded() ? "embedded" : "docker",
  };
}

export interface SetupFormProps {
  onDone: (result: { saved: boolean; error?: string }) => void;
}

export function SetupForm({ onDone }: SetupFormProps): ReactElement {
  const { exit } = useApp();
  const [values, setValues] = useState<Record<string, string>>(() => loadInitial());
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isDocker = (values["infra-mode"] ?? "docker") === "docker";
  // Docker mode shows the connection rows; Embedded mode shows the local-store
  // path rows; common rows (port / concurrency / OpenRouter) show in both.
  const visibleRows = ROWS.filter((r) => {
    if (r.infra === true) {
      return isDocker;
    }
    if (r.embedded === true) {
      return !isDocker;
    }
    return true;
  });

  const errors: Record<string, string | null> = {};
  for (const row of visibleRows) {
    errors[row.id] = row.validate(values[row.id] ?? "");
  }
  const allValid = visibleRows.every((r) => errors[r.id] === null);

  useInput((_input, key) => {
    if (key.escape) {
      exit();
      onDone({ saved: false });
      return;
    }
    if (key.return && allValid && submitError === null) {
      try {
        applyInfraMode((values["infra-mode"] ?? "docker") as InfraMode);
        for (const row of visibleRows) {
          const entry = KEY_MAP[row.cliKey];
          if (entry === undefined) {
            throw new Error(`No KEY_MAP entry for "${row.cliKey}"`);
          }
          entry.setter(values[row.id] ?? "");
        }
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
      <ToggleField
        id="infra-mode"
        label="Infrastructure"
        value={values["infra-mode"] ?? "docker"}
        options={MODE_OPTIONS}
        onChange={(next) => setValues((prev) => ({ ...prev, "infra-mode": next }))}
      />
      <Box marginBottom={1}>
        <Text dimColor> {infraModeOption(isDocker ? "docker" : "embedded").hint}</Text>
      </Box>
      {visibleRows.map((row) => (
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
        <Text dimColor>[Tab] next [Shift-Tab] back [←/→] switch [Enter] save [Esc] back to menu</Text>
      </Box>
      {submitError !== null && (
        <Box marginTop={1}>
          <Text color="red">save failed: {submitError}</Text>
        </Box>
      )}
    </Box>
  );
}
