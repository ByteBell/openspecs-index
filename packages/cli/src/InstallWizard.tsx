// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { FieldsStage, InfraStage, RepoStage, ConfirmStage } from "./InstallWizardStages.tsx";
import type { InfraMode } from "./infraMode.ts";

export type LlmProviderChoice = "openrouter" | "ollama";

export interface InstallWizardResult {
  provider: LlmProviderChoice;
  infraMode: InfraMode;
  openrouterApiKey?: string;
  openrouterModel?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  indexUrl?: string;
}

type Stage = "provider" | "infra" | "fields" | "repo" | "confirm";

interface ProviderItem {
  value: LlmProviderChoice;
  label: string;
  hint: string;
}

const PROVIDERS: ProviderItem[] = [
  { value: "openrouter", label: "OpenRouter", hint: "API key required — https://openrouter.ai" },
  { value: "ollama", label: "Ollama", hint: "local, free — must already be running" },
];

export interface InstallWizardProps {
  onDone: (result: InstallWizardResult) => void;
}

export function InstallWizard({ onDone }: InstallWizardProps): ReactElement {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>("provider");
  const [providerIdx, setProviderIdx] = useState(0);
  const [infraMode, setInfraMode] = useState<InfraMode>("embedded");
  const [apiKey, setApiKey] = useState("");
  const [orModel, setOrModel] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("");
  const [indexUrl, setIndexUrl] = useState("");

  useInput((input, key) => {
    if (stage === "provider") {
      if (key.escape) {
        exit();
        return;
      }
      if (key.upArrow || input === "k") {
        setProviderIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setProviderIdx((i) => Math.min(PROVIDERS.length - 1, i + 1));
        return;
      }
      if (key.return) {
        setStage("infra");
      }
    }
  });

  if (stage === "provider") {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
        <Box marginBottom={1}>
          <Text bold>Which LLM provider do you want to use?</Text>
        </Box>
        {PROVIDERS.map((p, i) => {
          const selected = i === providerIdx;
          return (
            <Box key={p.value} flexDirection="column">
              <Text color={selected ? "cyan" : "white"}>
                {selected ? "❯ " : "  "}
                {p.label}
              </Text>
              <Text dimColor> {p.hint}</Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>[↑/↓] choose [Enter] next [Esc] abort</Text>
        </Box>
      </Box>
    );
  }

  const p = PROVIDERS[providerIdx];
  const provider: LlmProviderChoice = p !== undefined ? p.value : "openrouter";

  const fieldsValid =
    provider === "openrouter"
      ? apiKey.trim().length > 0 && orModel.trim().length > 0
      : ollamaUrl.trim().length > 0 && ollamaModel.trim().length > 0;

  if (stage === "infra") {
    return (
      <InfraStage
        mode={infraMode}
        onMode={setInfraMode}
        onBack={() => setStage("provider")}
        onNext={() => setStage("fields")}
      />
    );
  }

  if (stage === "fields") {
    return (
      <FieldsStage
        provider={provider}
        apiKey={apiKey}
        onApiKey={setApiKey}
        orModel={orModel}
        onOrModel={setOrModel}
        ollamaUrl={ollamaUrl}
        onOllamaUrl={setOllamaUrl}
        ollamaModel={ollamaModel}
        onOllamaModel={setOllamaModel}
        valid={fieldsValid}
        onBack={() => setStage("infra")}
        onNext={() => setStage("repo")}
      />
    );
  }

  if (stage === "repo") {
    return (
      <RepoStage
        indexUrl={indexUrl}
        onIndexUrl={setIndexUrl}
        onBack={() => setStage("fields")}
        onNext={() => setStage("confirm")}
      />
    );
  }

  return (
    <ConfirmStage
      provider={provider}
      infraMode={infraMode}
      apiKey={apiKey}
      orModel={orModel}
      ollamaUrl={ollamaUrl}
      ollamaModel={ollamaModel}
      indexUrl={indexUrl}
      onBack={() => setStage("repo")}
      onDone={() => {
        exit();
        const result: InstallWizardResult = { provider, infraMode };
        if (provider === "openrouter") {
          result.openrouterApiKey = apiKey.trim();
          result.openrouterModel = orModel.trim();
        } else {
          result.ollamaUrl = ollamaUrl.trim();
          result.ollamaModel = ollamaModel.trim();
        }
        if (indexUrl.trim().length > 0) {
          result.indexUrl = indexUrl.trim();
        }
        onDone(result);
      }}
    />
  );
}
