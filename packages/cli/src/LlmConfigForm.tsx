import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useInput } from "ink";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { KEY_MAP } from "./keyMap.ts";
import { Field } from "./Field.tsx";
import { ControlsBar } from "./ControlsBar.tsx";
import { ACCENT } from "./theme.ts";

/**
 * Guided two-phase form for the LLM provider config.
 *
 *  Phase 1 (provider): pick openrouter or ollama — selector styled like the
 *  rest of the CLI (↑/↓ or j/k, Enter, Esc).
 *  Phase 2 (fields): edit just the chosen provider's fields and save. Uses
 *  Ink's focus manager (Tab/Shift-Tab) exactly like SetupForm; the API-key
 *  row is masked. Esc steps back to the provider choice.
 *
 * Every value persists through the existing KEY_MAP setters, so validation
 * and config-file writes stay identical to `bytebell set <key> <value>`.
 */

type Provider = "openrouter" | "ollama";

interface Row {
  id: string;
  label: string;
  cliKey: string;
  mask?: boolean;
}

const ROWS: Record<Provider, readonly Row[]> = {
  openrouter: [
    { id: "openrouter-api-key", label: "API key", cliKey: "openrouter-api-key", mask: true },
    { id: "openrouter-model", label: "Model", cliKey: "openrouter-model" },
  ],
  ollama: [
    { id: "ollama-url", label: "URL (local)", cliKey: "ollama-url" },
    { id: "ollama-model", label: "Model", cliKey: "ollama-model" },
  ],
};

const PROVIDERS: readonly { id: Provider; label: string; hint: string }[] = [
  { id: "openrouter", label: "OpenRouter", hint: "hosted models · needs an API key" },
  { id: "ollama", label: "Ollama (local)", hint: "local models · $0 cost · needs a running server" },
];

function loadInitial(): Record<string, string> {
  return {
    "openrouter-api-key": getConfigValue(Config.OpenrouterApiKey),
    "openrouter-model": getConfigValue(Config.OpenrouterModel),
    "ollama-url": getConfigValue(Config.OllamaUrl),
    "ollama-model": getConfigValue(Config.OllamaModel),
  };
}

export interface LlmConfigFormResult {
  saved?: boolean;
  back?: boolean;
  quit?: boolean;
}

export interface LlmConfigFormProps {
  onDone: (result: LlmConfigFormResult) => void;
}

export function LlmConfigForm({ onDone }: LlmConfigFormProps): ReactElement {
  const current = getConfigValue(Config.LlmProvider) as Provider;
  const [phase, setPhase] = useState<"provider" | "fields">("provider");
  const [provider, setProvider] = useState<Provider>(current);
  const [values, setValues] = useState<Record<string, string>>(() => loadInitial());

  if (phase === "provider") {
    return (
      <ProviderPicker
        current={provider}
        onPick={(p) => {
          setProvider(p);
          setPhase("fields");
        }}
        onBack={() => onDone({ back: true })}
        onQuit={() => onDone({ quit: true })}
      />
    );
  }
  return (
    <FieldsForm
      provider={provider}
      values={values}
      onChange={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))}
      onBack={() => setPhase("provider")}
      onSaved={() => onDone({ saved: true })}
    />
  );
}

interface ProviderPickerProps {
  current: Provider;
  onPick: (p: Provider) => void;
  onBack: () => void;
  onQuit: () => void;
}

function ProviderPicker({ current, onPick, onBack, onQuit }: ProviderPickerProps): ReactElement {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      PROVIDERS.findIndex((p) => p.id === current),
    ),
  );

  useInput((input, key) => {
    if (key.escape) {
      onQuit();
      return;
    }
    if (input === "q") {
      onBack();
      return;
    }
    if (key.upArrow || input === "k") {
      setIndex((i) => (i > 0 ? i - 1 : PROVIDERS.length - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setIndex((i) => (i < PROVIDERS.length - 1 ? i + 1 : 0));
      return;
    }
    if (key.return) {
      onPick(PROVIDERS[index]?.id ?? current);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={0}>
      <Box marginY={1}>
        <Text bold>Configure LLM provider</Text>
        <Text dimColor>{"   ·   current: "}</Text>
        <Text color={ACCENT}>{current}</Text>
      </Box>
      {PROVIDERS.map((p, i) => {
        const active = i === index;
        const activeProps = active ? { color: ACCENT } : {};
        return (
          <Box key={p.id}>
            <Text color={ACCENT}>{active ? " ❯ " : "   "}</Text>
            <Text {...activeProps}>{p.id === current ? "◉" : "○"} </Text>
            <Box width={16}>
              <Text {...activeProps} bold={active}>
                {p.label}
              </Text>
            </Box>
            <Text dimColor>{p.hint}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <ControlsBar
          controls={[
            { keys: "↑ ↓", label: "navigate" },
            { keys: "⏎", label: "choose" },
            { keys: "q", label: "back" },
            { keys: "esc", label: "quit" },
          ]}
        />
      </Box>
    </Box>
  );
}

interface FieldsFormProps {
  provider: Provider;
  values: Record<string, string>;
  onChange: (id: string, next: string) => void;
  onBack: () => void;
  onSaved: () => void;
}

function FieldsForm({ provider, values, onChange, onBack, onSaved }: FieldsFormProps): ReactElement {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const rows = ROWS[provider];

  const save = (): void => {
    try {
      KEY_MAP["llm-provider"]?.setter(provider);
      for (const row of rows) {
        KEY_MAP[row.cliKey]?.setter(values[row.id] ?? "");
      }
      onSaved();
    } catch (cause: unknown) {
      setSubmitError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Tab / Shift-Tab are handled natively by Ink's focus manager (each Field
  // joins via `useFocus`). Doing it manually here too would double-advance and
  // skip the second field — so we only handle Esc (back) and Enter (save).
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      save();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={0}>
      <Box marginY={1}>
        <Text bold>Configure </Text>
        <Text color={ACCENT} bold>
          {provider}
        </Text>
      </Box>
      {rows.map((row, i) => (
        <Field
          key={row.id}
          id={row.id}
          label={row.label}
          value={values[row.id] ?? ""}
          onChange={(next) => onChange(row.id, next)}
          autoFocus={i === 0}
          {...(row.mask === true ? { mask: true } : {})}
        />
      ))}
      <Box marginTop={1}>
        <ControlsBar
          controls={[
            { keys: "tab", label: "next" },
            { keys: "⇧tab", label: "back" },
            { keys: "⏎", label: "save" },
            { keys: "esc", label: "provider" },
          ]}
        />
      </Box>
      {submitError !== null && (
        <Box marginTop={1}>
          <Text color="red">save failed: {submitError}</Text>
        </Box>
      )}
    </Box>
  );
}
