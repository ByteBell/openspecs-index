# Why the IR is a verifiable layer, not a reversible one

This doc is the *theory*. It explains why the intermediate-representation
strategy is shaped the way it is, and why "verifiable" — not "reversible" — is
the right framing for what it produces.

The companion `README.md` describes *what* the strategy produces and *how it
runs*. This doc explains *why that shape is the right shape*.

## We stopped pretending we could read it all

Developers are more productive than ever, and the volume of machine-written
code is exploding. The number of humans who can actually understand that code
hasn't moved. The gap between what gets written and what anyone can vouch for
is where the debt lives, and it compounds — there is now AI slop piling on top
of the 10x of AI code we are already shipping.

When we first tried to close that gap, we tried to build a **reversible** layer
over code: a representation rich enough that the code could, in principle, be
reconstructed from it.

A colleague killed the idea in one sentence. A truly reversible layer has to
carry every bit of information the code carries, so it can never be simpler
than the code — and simplicity is exactly what you get from leaving things
out. You can pretty-print code, but pretty-printing is not what humans need at
this scale; the clarity that matters comes from leaving things out. The
moment you leave things out, you are no longer reversible.

Earlier attempts in the reversible-layer direction confirmed the critique.
They either grew as complex as the code they were hiding, or they lost detail
and needed escape hatches back to raw source.

We had to reposition. The point is not to rebuild code from the layer. It is
to **check that the code obeys it**.

## Three principles hold the verifiable layer together

**1. The layer captures intent.** What the system must do, the contracts it
must keep, the properties that stay true no matter what wrote the
implementation. This is what a human signs off on.

**2. The code is output.** A compiled artifact, not the source of truth.
Regenerate it a hundred times underneath — fine, as long as it still satisfies
the layer above.

**3. Spec and code are joined by verification, not conversion.** Types, tests,
properties, assertions, fingerprints. The system holds the mapping between
intent and implementation, and the checker proves the code never drifted from
what was approved.

The spec, not the code, is what you trust. Once machines write more code than
any team can read, the only thing worth trusting is a clear statement of what
the system must do, with continuous proof that it does that and nothing more.

That is what we are building: a **verifiable layer for code**. Not to read
everything the machine writes, but to make sure a human still vouches for what
matters, and to prove the code never drifted from it. The layer everyone
checks against shouldn't be a black box.

## How the IR realises a verifiable layer

The rest of this doc is a compressed tour of how the strategy produces that
layer in practice.

### What the layer captures

For every code unit the IR produces one structured record carrying three woven
layers:

- **Identity** — what the unit is, where it lives, its name path. The
  addressable handle.
- **Surface** — parameters, return shape, visibility, modifiers, generics. The
  contract a caller binds against.
- **Behaviour** — what it does, in what order, under what conditions, with
  what side effects, what it can fail with, what invariants it maintains,
  what it depends on. The contract a *re-implementer* must preserve.

The behaviour layer is the unusual one. Search indices don't produce it (no
semantics). AST extractors don't (behaviour isn't syntactic). Doc generators
don't (doc strings are stale or absent). It is the gap an LLM is best at
filling, *if* the task is narrow: "describe the behaviour of this one
already-extracted unit given the parent file's context" is exactly that task.

### Why phase the work

The pipeline is a small chain of focused passes, each with one job:

- **Different passes need different context.** File-level passes need the
  whole file; per-unit passes need one unit plus the file's established
  context. Mixing them dilutes both.
- **Different passes can use different models.** Few file calls can afford a
  careful model; hundreds of unit calls demand a fast, cheap one. Phasing
  makes routing trivial.
- **Different passes have different failure modes.** A malformed chunk pass
  must not poison the 600 unit calls beneath it. Persisting each phase's
  output contains failures.
- **Most re-runs are incremental.** Outputs keyed by file and unit make
  re-runs answer "have I done this one before?" with file presence — no
  diffing, no manifests, no cleverness.
- **Big files need a different journey.** A skim + cut prelude routes
  oversized files into the same downstream analysis as small ones, without
  forcing every small file to pay the overhead.

### Closing cross-file gaps: the MCP enrichment pass

A narrow per-unit window is what makes each LLM call cheap, but it leaves
records that are sometimes incomplete — the callee that resolves a vague
reference, the base class that clarifies an invariant, the test that pins
down an edge case all live elsewhere.

After the per-unit pass, every IR record is exposed through a tool-callable
surface (an MCP server). A separate LLM is turned loose with that toolbox to
*go fix the gaps*: pull any file/chunk/unit record by its handle, walk
references and inheritance, fetch raw source when the analysis isn't enough.
Every fix is written back into the same record shape. Downstream consumers
don't know the enrichment ran — the records simply become more complete.

This phase scales cleanly: as tool-use models improve, enrichment quality
improves without changing the record shape or the upstream phases.

### Verification, concretely

Two mechanisms turn the layer into one that *checks* code rather than
*reproduces* it:

- **Deterministic fingerprints**, computed in code (never by the LLM), over
  each unit's meaningful content. Cosmetic edits don't move the fingerprint;
  behavioural changes do. Re-run the strategy after a change and every
  meaningful drift shows up as a line in a diff — no humans, no full re-read.
- **Explicit contracts per unit** — surface, dependencies, error and
  edge-case behaviour, invariants. These are the things a checker (types,
  tests, properties) holds the regenerated or hand-edited code against.

### Regeneration as one consumer of the verifiable layer

Regeneration — producing the same software again, possibly in a different
language, with the same observable behaviour — is the cleanest test of the
layer. Given each unit's record, a regenerator gets:

- A precise statement of what the unit must do, separate from how it
  currently does it.
- The exact contract any reimplementation must preserve.
- A structured outline of control-flow without locking in syntax.
- The explicit external surface the unit reaches into.
- The error and edge-case contract, separated from happy-path logic.
- A fingerprint that flags any behavioural drift in the new version.

Because units link to callees and members by stable identity, regeneration
runs bottom-up: leaves first, then units that depend only on already-regenerated
leaves. Each step is a small, well-specified synthesis task with all of its
inputs known. The IR turns a globally-interdependent rewrite into a sequence
of locally-bounded ones — and the fingerprint check at the end is the
verification that the rewrite obeyed the layer.

### Why this design ages well

- **Provider independence.** Records describe content, not the call that
  produced it. Swap the LLM behind any phase and the on-disk format is
  unchanged.
- **Forward-compatible record shape.** Explicit identity, explicit spans,
  explicit references. New optional fields cost nothing; old consumers
  ignore them. The schema grows without forcing a full re-index.

The records produced today will still be interpretable, queryable, and
checkable when the model behind the strategy has been replaced three times.

## In one sentence

The IR strategy is a **verifiable layer**: a graph of structured, contract-
bearing per-unit records, produced by a chain of focused, cacheable,
model-agnostic passes and closed under an MCP-fronted cross-file enrichment,
against which any implementation — hand-written or regenerated — can be
checked for drift from the intent a human signed off on.
