# `@bb/llm/src` — context

Implementation of `@bb/llm`. See [../README.md](../README.md) for the
package-level contract; this file documents how the source tree is split.

## Files

- **[index.ts](index.ts)** — public re-exports. The only entry point other
  packages may import. Exposes `askLLM`, the `AskLlmOptions` type, the
  `LlmProviderName` union (six backends), plus the JSON
  client surface. Anything not re-exported here is internal.
- **[client.ts](client.ts)** — the `askLLM` orchestrator. Selects the
  active provider via `opts.provider ?? getConfigValue(Config.LlmProvider)`
  (per-call override beats config), then dispatches through the
  `providers.ts` table. Consults the filesystem decision cache before issuing a
  request. Throws typed errors via `@bb/errors`.
- **[attempt.ts](attempt.ts)** — per-attempt resilience for the client-side
  providers. `retryTransient` retries ONE turn in place on a 429 / 5xx /
  timeout (exponential backoff, 3 attempts); `walkChain` walks a model chain,
  next model on any failure; `causeMessage` preserves the provider status +
  message when wrapping, because the failure classifier reads that string.
  OpenRouter needs none of this — it takes a server-side `models: [...]` array
  and reroutes internally. Everything else resolves a single-element chain
  unless the caller passes `opts.fallbackModels`, so without in-place retry one
  429 is a hard failure for that file, and in a pipeline where any file failure
  fails the run that discards an hour of work. BullMQ's `attempts: 3` retries
  the whole job and re-bills the files that already succeeded; this does not.
- **[providers.ts](providers.ts)** — `LLM_PROVIDER_ENTRIES`, the
  provider dispatch table. One entry per backend
  (`resolveChain` / `call` / `reportsCost` / `supportsTools`);
  `resolveProviderEntry(name)` throws `LlmConfigError` listing every valid
  name rather than silently falling back, so a typo in `llm_provider` fails
  loudly instead of billing the wrong account. Adding a backend is one entry
  here plus one module — `client.ts` never branches on provider identity.
- **[anthropicMessages.ts](anthropicMessages.ts)** — the Anthropic Messages
  wire format, used by the direct Anthropic API. (Bedrock shared this module
  until it moved to Converse — that move is what made Bedrock family-agnostic.)
  Owns `supportsTemperature()`, which both providers need: current Claude
  families reject `temperature` on every platform, and the OpenAI families on
  Bedrock reject it while Anthropic / Nova / Llama / Mistral accept it. Without
  it the skip-decision gate's `temperature: 0` would hard-fail every scan. Also
  refusal detection (`stop_reason: "refusal"` is HTTP 200 with empty content)
  and `thinking`-block filtering.
- **[anthropic.ts](anthropic.ts)** — `callAnthropic` / `resolveAnthropicChain`.
  `x-api-key` + `anthropic-version: 2023-06-01`, model in the body.
- **[bedrock.ts](bedrock.ts)** — `callBedrock` / `resolveBedrockChain` /
  `resolveBedrockAuth`, over Converse via `@ai-sdk/amazon-bedrock`. The one
  provider that takes an SDK: Converse has its own request shape and, without a
  Bedrock API key, SigV4-signed requests — which must not be hand-rolled. The
  SDK also resolves the AWS default credential chain, so an EC2/EKS deployment
  authenticates from its instance role. Auth precedence: API key → static SigV4
  credentials → default chain. Covers every Bedrock family plus inference
  profiles and ARNs. Clients cached per region + key-prefix, never the secret.

- **[openaiCompatible.ts](openaiCompatible.ts)** — `openAiCompatibleChat`: one
  attempt against any OpenAI-shaped `/chat/completions`. OpenAI, OpenRouter,
  Gemini's compatible surface, Bedrock's `/openai/v1` route and every
  self-hosted gateway speak this format, so a new provider is a base URL and a
  model chain rather than another hand-copied fetch with its own subtly
  different error handling.
- **[openai.ts](openai.ts)** — `callOpenAi` / `resolveOpenAiChain` /
  `openAiBase`. Direct OpenAI, or any OpenAI-compatible server via
  `Config.OpenaiBaseUrl` (vLLM / LiteLLM / an internal gateway).
- **[toolChat.ts](toolChat.ts)** — `toolChat`: one tool-capable turn on any
  non-OpenRouter provider, through the `openai` SDK pointed at that provider's
  OpenAI-compatible base URL. Tool use used to be OpenRouter-only and threw
  everywhere else, which meant `concept-graph` silently vanished on a provider
  switch — that is a feature disappearing, not a provider switching. Bedrock's
  route here is bearer-authenticated, so tool use needs the API key even when
  the main call path uses SigV4.
- \*\*[gemini.ts](gemini.ts) — `callGemini` / `resolveGeminiChain`.
  `x-goog-api-key`, `:generateContent`, `systemInstruction` / `contents`
  mapping, and `promptFeedback.blockReason` surfaced as a typed error.
- **[openrouter.ts](openrouter.ts)** — `callOpenRouter` and
  `resolveOpenRouterChain`. Resolves the API key (`opts.apiKey
?? getConfigValue(Config.OpenrouterApiKey)`) and the model chain
  (capped at 3 entries — OpenRouter's hard limit). Delegates the HTTP
  request to `openRouterRawChat` in `openrouterChat.ts`. Returns the
  first choice's content as a plain `{ content, usage }` pair. Throws
  `LlmConfigError` if the key is empty and `LlmError` on timeout /
  non-2xx / empty completion.
- **[openrouterChat.ts](openrouterChat.ts)** — `openRouterRawChat`:
  lower-level POST to the chat-completions endpoint that accepts
  arbitrary `messages[]` (including `assistant` with `tool_calls` and
  `tool` results) and an optional `tools[]` list. Returns the full
  assistant message so callers can dispatch on `tool_calls`. Always
  sends `provider: { allow_fallbacks: false }` (OpenRouter cannot
  silently route across upstream providers) and `usage: { include: true }`
  (authoritative billed cost in the response). Consumed by
  `callOpenRouter` (single-shot wrapper) and `toolLoop.ts`.
- **[toolLoop.ts](toolLoop.ts)** — `askLLMWithTools`: multi-turn
  tool-use driver. Builds initial messages from `prompt` + optional
  `systemPrompt`, calls `openRouterRawChat` with the caller's
  `tools[]`, and loops on `tool_calls` until the model returns a
  terminal text turn or a cap fires. Caps: `maxIterations`,
  `maxToolCalls`, `wallTimeMs` (global) and `perRequestTimeoutMs`
  (per request, capped at remaining wall-time). Per-result strings are
  truncated to `maxToolResultChars` (default 20000) before being fed
  back to the model. Provider scope is OpenRouter only — Ollama is
  rejected at the entrypoint because OpenAI-tool-format support varies
  across open models. Cumulative `usage` (input + output tokens, cost)
  is summed across every iteration.
- **[toolTypes.ts](toolTypes.ts)** — `ToolDefinition`, `ToolInvocation`,
  `LoopTerminationReason` (`completed | max-iterations | max-tool-calls
| wall-time-exceeded | empty-response`), `AskLLMWithToolsOptions`,
  `AskLLMWithToolsResult`.
- **[ollama.ts](ollama.ts)** — `callOllama` and `resolveOllamaChain`.
  Single-model per request (Ollama has no fan-out). Reads model from
  `opts.model ?? Config.OllamaModel`. Ignores `opts.apiKey` (Ollama is
  keyless).
- **[jsonClient.ts](jsonClient.ts)** — `askJsonLLM`, `askYesNoLLM`,
  `tryParseJson`, `stripJsonFence`. Wraps `askLLM` with JSON-strict
  retry logic. Forwards `opts` (including `apiKey` / `provider` / `model`)
  to `askLLM` unchanged.
- **[cache.ts](cache.ts)** — filesystem-backed decision cache. Key
  includes `provider` and `modelChain`; `opts.apiKey` is intentionally
  NOT part of the key (the cached decision is the same regardless of
  which key produced it — keys are auth, not semantic input).
- **[tokenizer.ts](tokenizer.ts)** — `tokenLen`, `encodeTokens`,
  `decodeTokens`. Module-cached `tiktoken` encoder using `cl100k_base`,
  lazy-initialized via `get_encoding`. All three helpers fall back to
  char/4 (`tokenLen`) or empty result (`encodeTokens` / `decodeTokens`)
  if the WASM init fails — pipeline keeps running even on exotic Bun
  builds.
- **[pricing.ts](pricing.ts)** — `estimateCostUsd` and
  `estimateCostFromBreakdown`. One-shot fetch of OpenRouter's
  `/api/v1/models` (cached for the process lifetime).

## Module dependency graph

```
client.ts    → @bb/config (getConfigValue), @bb/types (Config),
               @bb/errors (LlmConfigError, LlmError)
               (built-in: fetch, AbortController, setTimeout)
tokenizer.ts → tiktoken (npm: get_encoding, Tiktoken type)
pricing.ts   → @bb/config, @bb/types
index.ts     → re-exports the public surface from client.ts,
               tokenizer.ts, pricing.ts
```

No cycles. Each implementation file owns one concern (HTTP, tokens,
pricing).

## Invariants enforced here

- **No module state.** `askLLM` constructs a fresh request per call; no
  caching, no shared client, no memoization. Tests need no reset hook.
- **Timeout is honored.** AbortController fires at `timeoutMs`; the
  `clearTimeout` call lives in a `finally` so the timer is always
  cleared regardless of fetch outcome.
- **Errors carry typed metadata.** `LlmConfigError` carries the
  `bytebell keys set` hint; `LlmError` accepts an optional `cause` and
  composes a single-line message capped at 500 chars of any HTTP error
  body (so the logger doesn't blow up on multi-MB error responses).
- **No env reads.** Secrets come from `opts.apiKey` first, then
  `getConfigValue(Config.OpenrouterApiKey)`. Same fallback shape for the
  provider switch via `opts.provider` → `Config.LlmProvider`.
- **Empty completions are errors.** A 200 OK with no `choices[0].message
.content` throws `LlmError("OpenRouter returned empty completion")` —
  do not silently return an empty string.

## Adding a helper

Follow the recipes in [../README.md](../README.md) under _How to
extend_. New files live as flat `src/<name>.ts` (the repo ESLint rule
forbids parent traversal — keep `src/` flat).
