// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { FieldsStage, InfraStage, RepoStage, ConfirmStage } from "./InstallWizardStages.tsx";
import type { InfraMode } from "./infraMode.ts";
import {
  LLM_PROVIDER_SPECS,
  initialProviderValues,
  providerFieldsValid,
  providerSpec,
  type LlmProviderChoice,
} from "./llmProviders.ts";

export type { LlmProviderChoice } from "./llmProviders.ts";

export interface InstallWizardResult {
  provider: LlmProviderChoice;
  infraMode: InfraMode;
  /** Field values keyed by `KEY_MAP` key — only the chosen provider's fields. */
  providerValues: Record<string, string>;
  indexUrl?: string;
}

type Stage = "provider" | "infra" | "fields" | "repo" | "confirm";

export interface InstallWizardProps {
  onDone: (result: InstallWizardResult) => void;
}

export function InstallWizard({ onDone }: InstallWizardProps): ReactElement {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>("provider");
  const [providerIdx, setProviderIdx] = useState(0);
  const [infraMode, setInfraMode] = useState<InfraMode>("embedded");
  const [values, setValues] = useState<Record<string, string>>(() => initialProviderValues());
  const [indexUrl, setIndexUrl] = useState("");

  useInput((input, key) => {
    if (stage !== "provider") {
      return;
    }
    if (key.escape) {
      exit();
      return;
    }
    if (key.upArrow || input === "k") {
      setProviderIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setProviderIdx((i) => Math.min(LLM_PROVIDER_SPECS.length - 1, i + 1));
      return;
    }
    if (key.return) {
      setStage("infra");
    }
  });

  if (stage === "provider") {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
        <Box marginBottom={1}>
          <Text bold>Which LLM provider do you want to use?</Text>
        </Box>
        {LLM_PROVIDER_SPECS.map((p, i) => {
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

  const selected = LLM_PROVIDER_SPECS[providerIdx];
  const provider: LlmProviderChoice = selected !== undefined ? selected.value : "openrouter";
  const spec = providerSpec(provider);
  const fieldsValid = providerFieldsValid(spec, values);

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
        spec={spec}
        values={values}
        onChange={(cliKey, next) => setValues((prev) => ({ ...prev, [cliKey]: next }))}
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
      spec={spec}
      values={values}
      infraMode={infraMode}
      indexUrl={indexUrl}
      onBack={() => setStage("repo")}
      onDone={() => {
        exit();
        const providerValues: Record<string, string> = {};
        for (const field of spec.fields) {
          providerValues[field.cliKey] = (values[field.cliKey] ?? "").trim();
        }
        const result: InstallWizardResult = { provider, infraMode, providerValues };
        if (indexUrl.trim().length > 0) {
          result.indexUrl = indexUrl.trim();
        }
        onDone(result);
      }}
    />
  );
}
