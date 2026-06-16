import { test, expect } from "bun:test";
import { withUsageMeter } from "./context.ts";
import type { UsageGuard } from "@bb/types";
import type { AskLlmUsage } from "@bb/llm";

function recordingGuard(): { guard: UsageGuard; metered: AskLlmUsage[] } {
  const metered: AskLlmUsage[] = [];
  const guard: UsageGuard = {
    onPhaseComplete: async () => {},
    flushPartial: async () => {},
    meterUsage: (u) => {
      metered.push(u as AskLlmUsage);
    },
  };
  return { guard, metered };
}

test("withUsageMeter returns the context unchanged when there is no guard", () => {
  const ctx = { apiKey: "k" };
  expect(withUsageMeter(ctx, undefined)).toBe(ctx); // OSS standalone: no billing
  expect(withUsageMeter(undefined, undefined)).toBeUndefined();
});

test("withUsageMeter wires onUsage → guard.meterUsage and preserves existing options", () => {
  const { guard, metered } = recordingGuard();
  const out = withUsageMeter({ apiKey: "k", model: "m" }, guard);
  expect(out?.apiKey).toBe("k");
  expect(out?.model).toBe("m");

  // Every provider call (fresh or cached) flows through to the meter with its flag intact.
  const fresh: AskLlmUsage = { model: "m", inputTokens: 10, outputTokens: 5, costUsd: 0.01, cached: false };
  const hit: AskLlmUsage = { model: "m", inputTokens: 8, outputTokens: 3, costUsd: 0.002, cached: true };
  out?.onUsage?.(fresh);
  out?.onUsage?.(hit);
  expect(metered).toEqual([fresh, hit]);
});

test("withUsageMeter adds onUsage even when there is no base context", () => {
  const { guard, metered } = recordingGuard();
  const out = withUsageMeter(undefined, guard);
  expect(typeof out?.onUsage).toBe("function");
  out?.onUsage?.({ model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0, cached: false });
  expect(metered).toHaveLength(1);
});
