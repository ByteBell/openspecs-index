// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import type { ReactElement } from "react";
import { Box, Text, useFocus, useInput } from "ink";

export interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  /** Shown dimmed under the row — e.g. what the selected option requires. */
  hint?: string;
}

/**
 * An N-option cycling selector that joins the form's Tab order via `useFocus`.
 * ←/→/space step through the options, wrapping at both ends.
 *
 * Distinct from `ToggleField`, which is typed to exactly two options — fine for
 * docker/embedded, but the LLM provider list is six and growing.
 */
export function SelectField({ id, label, value, options, onChange, hint }: SelectFieldProps): ReactElement {
  const { isFocused } = useFocus({ id });
  const current = Math.max(0, options.indexOf(value));

  useInput(
    (input, key) => {
      if (options.length === 0) {
        return;
      }
      if (key.leftArrow) {
        onChange(options[(current - 1 + options.length) % options.length] ?? value);
        return;
      }
      if (key.rightArrow || input === " ") {
        onChange(options[(current + 1) % options.length] ?? value);
      }
    },
    { isActive: isFocused },
  );

  const labelProps = isFocused ? { color: "cyan" } : {};

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={2}>
          <Text {...labelProps}>{isFocused ? "▶" : " "}</Text>
        </Box>
        <Box width={20}>
          <Text {...labelProps}>{label}</Text>
        </Box>
        <Box>
          <Text color="green">{value}</Text>
          <Text dimColor>
            {"   "}({current + 1}/{options.length}
            {isFocused ? " — ←/→ to switch" : ""})
          </Text>
        </Box>
      </Box>
      {hint !== undefined && hint.length > 0 && (
        <Box>
          <Box width={22} />
          <Text dimColor>{hint}</Text>
        </Box>
      )}
    </Box>
  );
}
