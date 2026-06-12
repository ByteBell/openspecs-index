import type { ReactElement } from "react";
import { Box, Text, useFocus } from "ink";
import TextInput from "ink-text-input";
import { ACCENT } from "./theme.ts";

export interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  mask?: boolean;
  error?: string;
  autoFocus?: boolean;
}

export function Field({ id, label, value, onChange, mask, error, autoFocus }: FieldProps): ReactElement {
  const { isFocused } = useFocus({ id, autoFocus: autoFocus === true });
  const indicator = isFocused ? "▶" : " ";
  const labelProps = isFocused ? { color: ACCENT } : {};
  const masked = mask === true;
  const displayValue = masked && value.length > 0 ? "•".repeat(value.length) : value;
  const inputProps = masked ? { value, onChange, mask: "•" } : { value, onChange };

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={2}>
          <Text {...labelProps}>{indicator}</Text>
        </Box>
        <Box width={20}>
          <Text {...labelProps}>{label}</Text>
        </Box>
        <Box>{isFocused ? <TextInput {...inputProps} /> : <Text>{displayValue}</Text>}</Box>
      </Box>
      {error !== undefined && error.length > 0 && (
        <Box paddingLeft={22}>
          <Text color="red">{error}</Text>
        </Box>
      )}
    </Box>
  );
}
