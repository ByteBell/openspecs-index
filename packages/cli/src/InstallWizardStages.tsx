// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import type { ReactElement } from "react";
import { Box, Text, useInput } from "ink";
import { Field } from "./Field.tsx";
import { maskSecret, type ProviderSpec } from "./llmProviders.ts";
import { INFRA_MODE_OPTIONS as INFRA_OPTIONS, type InfraMode } from "./infraMode.ts";

export interface InfraStageProps {
  mode: InfraMode;
  onMode: (m: InfraMode) => void;
  onBack: () => void;
  onNext: () => void;
}

export function InfraStage({ mode, onMode, onBack, onNext }: InfraStageProps): ReactElement {
  const idx = INFRA_OPTIONS.findIndex((o) => o.value === mode);
  const current = idx === -1 ? 0 : idx;

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow || input === "k") {
      const next = INFRA_OPTIONS[Math.max(0, current - 1)];
      if (next !== undefined) {
        onMode(next.value);
      }
      return;
    }
    if (key.downArrow || input === "j") {
      const next = INFRA_OPTIONS[Math.min(INFRA_OPTIONS.length - 1, current + 1)];
      if (next !== undefined) {
        onMode(next.value);
      }
      return;
    }
    if (key.return) {
      onNext();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>How should ByteBell run its databases?</Text>
      </Box>
      {INFRA_OPTIONS.map((o, i) => {
        const selected = i === current;
        return (
          <Box key={o.value} flexDirection="column">
            <Text color={selected ? "cyan" : "white"}>
              {selected ? "❯ " : "  "}
              {o.label}
            </Text>
            <Text dimColor> {o.hint}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>[↑/↓] choose [Enter] next [Esc] back</Text>
      </Box>
    </Box>
  );
}

export interface FieldsStageProps {
  spec: ProviderSpec;
  values: Record<string, string>;
  onChange: (cliKey: string, next: string) => void;
  valid: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function FieldsStage({ spec, values, onChange, valid, onBack, onNext }: FieldsStageProps): ReactElement {
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return && valid) {
      onNext();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>{spec.label} configuration</Text>
      </Box>
      {spec.fields.map((field, i) => (
        <Box key={field.cliKey} flexDirection="column">
          <Field
            id={field.cliKey}
            label={field.label}
            value={values[field.cliKey] ?? ""}
            onChange={(next) => onChange(field.cliKey, next)}
            {...(field.mask === true ? { mask: true } : {})}
            {...(i === 0 ? { autoFocus: true } : {})}
          />
          <Text dimColor> {field.hint}</Text>
        </Box>
      ))}
      {!spec.supportsTools && (
        <Box marginTop={1}>
          <Text color="yellow">
            note: {spec.label} does not support tool use — the concept-graph strategy needs OpenRouter. The default
            flat-folder strategy works on every provider.
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>[Tab] next field [Enter] continue{valid ? "" : " (fill all fields)"} [Esc] back</Text>
      </Box>
    </Box>
  );
}

export interface RepoStageProps {
  indexUrl: string;
  onIndexUrl: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function RepoStage({ indexUrl, onIndexUrl, onBack, onNext }: RepoStageProps): ReactElement {
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      onNext();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Index a GitHub repo after boot?</Text>
      </Box>
      <Field id="repo-url" label="Repo URL" value={indexUrl} onChange={onIndexUrl} autoFocus />
      <Box marginTop={1}>
        <Text dimColor>[Enter] next (blank = skip) [Esc] back</Text>
      </Box>
    </Box>
  );
}

export interface ConfirmStageProps {
  spec: ProviderSpec;
  values: Record<string, string>;
  infraMode: InfraMode;
  indexUrl: string;
  onBack: () => void;
  onDone: () => void;
}

export function ConfirmStage({ spec, values, infraMode, indexUrl, onBack, onDone }: ConfirmStageProps): ReactElement {
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Ready to apply — confirm settings</Text>
      </Box>
      <Box flexDirection="column" gap={0}>
        <Text>
          {" "}
          Provider : <Text color="cyan">{spec.label}</Text>
        </Text>
        <Text>
          {" "}
          Infra :{" "}
          <Text color="cyan">
            {infraMode === "embedded"
              ? "embedded (no Docker)"
              : infraMode === "cloud"
                ? "cloud (external databases, no Docker)"
                : "docker (local containers)"}
          </Text>
        </Text>
        {spec.fields.map((field) => {
          const raw = (values[field.cliKey] ?? "").trim();
          return (
            <Text key={field.cliKey}>
              {" "}
              {field.label} :{" "}
              {field.mask === true ? (
                <Text dimColor>{maskSecret(raw)}</Text>
              ) : (
                <Text color="cyan">{raw.length > 0 ? raw : "(not set)"}</Text>
              )}
            </Text>
          );
        })}
        <Text>
          {" "}
          Index : <Text color="cyan">{indexUrl.trim().length > 0 ? indexUrl : "(skip)"}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[Enter] apply & boot [Esc] back</Text>
      </Box>
    </Box>
  );
}
