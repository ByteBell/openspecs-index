import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useInput } from "ink";
import { Field } from "./Field.tsx";
import { ControlsBar } from "./ControlsBar.tsx";
import { ACCENT } from "./theme.ts";

export interface ArgSpec {
  /** Positional name shown as the field label, e.g. "git-url". */
  name: string;
  /** Whether Enter is allowed while the value is empty. */
  optional?: boolean;
  /** Greyed placeholder describing the expected value. */
  placeholder?: string;
}

export interface ArgPromptResult {
  values?: string[];
  cancelled?: boolean;
}

export interface ArgPromptProps {
  title: string;
  description: string;
  specs: readonly ArgSpec[];
  onDone: (result: ArgPromptResult) => void;
}

/**
 * Collects positional arguments for a menu-launched command (e.g. `index`
 * needs a git-url, `ingest` an optional path). One field at a time: Enter
 * advances, and on the last field submits the collected values. Esc returns
 * to the menu. Required fields refuse to advance while empty.
 */
export function ArgPrompt({ title, description, specs, onDone }: ArgPromptProps): ReactElement {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<string[]>(() => specs.map(() => ""));

  const spec = specs[step];
  const value = values[step] ?? "";
  const canAdvance = value.length > 0 || spec?.optional === true;

  const setValue = (next: string): void => {
    setValues((prev) => {
      const copy = [...prev];
      copy[step] = next;
      return copy;
    });
  };

  useInput((_input, key) => {
    if (key.escape) {
      onDone({ cancelled: true });
      return;
    }
    if (key.return && canAdvance) {
      if (step < specs.length - 1) {
        setStep((s) => s + 1);
        return;
      }
      onDone({ values });
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={0}>
      <Box marginY={1}>
        <Text color={ACCENT} bold>
          {title}
        </Text>
        <Text dimColor>{`   ·   ${description}`}</Text>
      </Box>
      {specs.map((s, i) => (
        <Box key={s.name} flexDirection="column">
          {i === step ? (
            <Field id={s.name} label={s.name} value={values[i] ?? ""} onChange={setValue} autoFocus />
          ) : (
            <Box>
              <Box width={2}>
                <Text dimColor>{i < step ? "✓" : " "}</Text>
              </Box>
              <Box width={20}>
                <Text dimColor>{s.name}</Text>
              </Box>
              <Text dimColor>{values[i] ?? ""}</Text>
            </Box>
          )}
        </Box>
      ))}
      {spec?.placeholder !== undefined && (
        <Box marginTop={1}>
          <Text dimColor>{spec.placeholder}</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <ControlsBar
          controls={[
            { keys: "⏎", label: step < specs.length - 1 ? "next" : "run" },
            { keys: "esc", label: "back" },
          ]}
        />
        {spec?.optional === true && <Text dimColor>leave blank to use the default</Text>}
      </Box>
    </Box>
  );
}
