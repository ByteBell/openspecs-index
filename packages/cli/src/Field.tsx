import type { ReactElement } from "react";
import { Box, Text, useFocus } from "ink";
import TextInput from "ink-text-input";

export interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  mask?: boolean;
  error?: string;
  autoFocus?: boolean;
  isFocused?: boolean;
}

export function Field({
  id,
  label,
  value,
  onChange,
  mask,
  error,
  autoFocus,
  isFocused: propFocused,
}: FieldProps): ReactElement {
  const { isFocused: hookFocused } = useFocus({ id, autoFocus: autoFocus === true });
  const isFocused = propFocused !== undefined ? propFocused : hookFocused;
  const indicator = isFocused ? "▶" : " ";
  const labelProps = isFocused ? { color: "cyan" } : {};
  const masked = mask === true;
  const displayValue = masked && value.length > 0 ? "•".repeat(value.length) : value;
  const inputProps = masked ? { value, onChange, mask: "•", focus: isFocused } : { value, onChange, focus: isFocused };

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
