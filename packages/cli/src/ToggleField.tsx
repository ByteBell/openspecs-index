import type { ReactElement } from "react";
import { Box, Text, useFocus, useInput } from "ink";

export interface ToggleFieldProps {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  isFocused?: boolean;
}

/**
 * An option switch that joins the form's Tab order via `useFocus`. When
 * focused, ←/→/space cycle between the options. Distinct from the text
 * `Field` so options read as radio toggles rather than free text.
 */
export function ToggleField({
  id,
  label,
  value,
  options,
  onChange,
  isFocused: propFocused,
}: ToggleFieldProps): ReactElement {
  const { isFocused: hookFocused } = useFocus({ id });
  const isFocused = propFocused !== undefined ? propFocused : hookFocused;
  const current = Math.max(0, options.indexOf(value));

  useInput(
    (input, key) => {
      if (options.length === 0) {
        return;
      }
      if (key.leftArrow) {
        const next = options[(current - 1 + options.length) % options.length];
        if (next !== undefined) {
          onChange(next);
        }
        return;
      }
      if (key.rightArrow || input === " ") {
        const next = options[(current + 1) % options.length];
        if (next !== undefined) {
          onChange(next);
        }
      }
    },
    { isActive: isFocused },
  );

  const indicator = isFocused ? "▶" : " ";
  const labelProps = isFocused ? { color: "cyan" } : {};

  return (
    <Box>
      <Box width={2}>
        <Text {...labelProps}>{indicator}</Text>
      </Box>
      <Box width={20}>
        <Text {...labelProps}>{label}</Text>
      </Box>
      <Box>
        {options.map((opt) => {
          const isSelected = value === opt;
          return (
            <Box key={opt} marginRight={3}>
              <Text {...(isSelected ? { color: "green" } : {})}>
                {isSelected ? "◉" : "○"} {opt}
              </Text>
            </Box>
          );
        })}
        {isFocused && <Text dimColor>{"(←/→ to switch)"}</Text>}
      </Box>
    </Box>
  );
}
