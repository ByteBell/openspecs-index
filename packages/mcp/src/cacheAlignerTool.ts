// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UsageTracker } from "@bb/llm";
import { align, type AlignResult, type Segment } from "./cacheAligner.ts";

const description = `Stabilize LLM prompt for KV cache optimization.

Problem: LLM KV caches activate only when the prompt prefix is byte-identical.
Dynamic content (timestamps, UUIDs, session IDs) mid-prompt busts cache every call.

Solution: Classify each segment as static/session/dynamic, reorder so stable
content is always the prefix and dynamic content is always the tail. Send the
stable prefix with cache_control annotations; send the dynamic tail without.

PARAMS:
- prompt: the prompt string to align (required)
- history: previous versions of this prompt for variance detection (optional)`;

const schema = {
  prompt: z.string().min(1).describe("The prompt to align for cache optimization"),
  history: z
    .array(z.string())
    .optional()
    .describe("Previous versions of this prompt for variance-based classification"),
};

export interface CacheAlignerInput {
  prompt: string;
  history?: string[] | undefined;
}

export type { AlignResult, Segment };

export function registerCacheAlignerTool(server: McpServer): void {
  server.registerTool("cache_aligner", { description, inputSchema: schema }, async (args: CacheAlignerInput) => {
    const startTime = Date.now();
    const result = runCacheAligner(args);
    const payload = JSON.stringify(result, null, 2);
    const durationMs = Date.now() - startTime;

    await UsageTracker.track(
      "local-user",
      "cache_aligner",
      JSON.stringify(args.prompt).slice(0, 200),
      payload,
      durationMs,
    );

    return { content: [{ type: "text" as const, text: payload }] };
  });
}

export function runCacheAligner(args: CacheAlignerInput): AlignResult {
  return align(args.prompt, args.history !== undefined ? { history: args.history } : {});
}
