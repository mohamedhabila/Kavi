# Measured Hybrid Memory Retrieval

Research snapshot: 2026-07-10. Updated 2026-09-05: provider-backed semantic vectors (see "Provider-backed semantic lane" below).

## Product decision

Kavi keeps its local SQLite memory store and provider-neutral request path. Hybrid retrieval is a bounded union of local candidate lanes, not a new memory backend, service, reranking model, or network call. Every lane must apply the existing scope, validity, deletion, expiry, and opt-out rules before a candidate can be ranked. The semantic lane's vectors may now come from a configured embedding provider (see below), but the lane structure, union, and scoring still run entirely against local SQLite rows — no candidate lane itself performs a network call.

Recall eligibility is enforced in SQL before every lane's `ORDER BY` and `LIMIT`: project facts are exact to the active root, conversation facts are root-wide, and session facts are exact to root plus task and source thread when the thread is available. Raw unknown scopes never normalize into a visible recall branch. Exact persona ownership remains gated on the owner/persona identity schema rather than being inferred from content.

The production strategy is `hybrid`; `lexical` remains an exact same-path ablation. Both strategies use the same downstream scorer, optional semantic selector, prompt assembly, and answer model. If compatible local embeddings are absent, semantic contribution is explicitly unavailable and lexical retrieval continues deterministically.

## Primary-source findings

| Project                                                                                                                                      | Relevant primary-source pattern                                                                                                                                                                                    | License verified                                                   | Decision                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Hindsight](https://github.com/vectorize-io/hindsight#recall)                                                                                | Parallel semantic, keyword, graph/entity-time, and temporal lanes; reciprocal-rank fusion; final token trimming.                                                                                                   | [MIT](https://github.com/vectorize-io/hindsight/blob/main/LICENSE) | Adopt the bounded multi-lane and rank-fusion shape. Do not adopt its server, database, LLM extraction, cross-encoder, SDK, or code.                                       |
| [Mem0](https://github.com/mem0ai/mem0#new-memory-algorithm-april-2026)                                                                       | Single-pass multi-signal semantic, keyword, entity, and temporal retrieval with measured token/latency reporting. Its README explicitly distinguishes proprietary managed optimizations from open-source behavior. | [Apache-2.0](https://github.com/mem0ai/mem0/blob/main/LICENSE)     | Adopt content-free per-stage measurement and same-stack ablation discipline. Do not import claimed scores, managed behavior, services, or code.                           |
| [A-MEM paper](https://arxiv.org/abs/2502.12110) and [official implementation](https://github.com/agiresearch/A-mem)                          | Structured notes, keywords/tags, and semantic links form multiple retrieval paths instead of relying on one flat vector query.                                                                                     | [MIT](https://github.com/agiresearch/A-mem/blob/main/LICENSE)      | Reuse existing Kavi fact/entity/provenance structure as retrieval signals. Do not add ChromaDB, LLM-generated query links, automatic memory mutation, or code from A-MEM. |
| [LangMem](https://github.com/langchain-ai/langmem) and [conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/) | Semantic, episodic, and procedural memories remain distinct and are isolated through configurable namespaces.                                                                                                      | [MIT](https://github.com/langchain-ai/langmem/blob/main/LICENSE)   | Preserve Kavi scope and memory-kind boundaries before union/ranking. Do not add LangGraph/LangMem storage, agents, embeddings, or code.                                   |

This is architectural research only. No third-party implementation is copied or linked into the app.

## Frozen candidate contract

Candidate reasons are closed and content-free: `pinned`, `exact_quoted`, `lexical`, `entity`, `temporal`, and `local_semantic` (code identifier `local_similarity`) — one semantic reason covering both the on-device fallback vector and, when available, a provider-backed vector; a candidate's provenance carries whichever score(s) actually matched. A candidate can have multiple reasons and lane ranks. Weighted reciprocal-rank fusion orders the union; one diversity pass protects distinct run, task, turn, conversation, subject, and predicate groups before remaining capacity is filled.

Bounds:

- default union: 128 facts; existing hard maximum: 2,000;
- supplemental eligible scan: 256 facts, hard maximum 500;
- exact/quoted: 24; entity: 32; temporal: 24; semantic (local and/or provider): 32 — one lane, not two: a candidate surfaces here once, carrying whichever score(s) are available;
- local semantic vectors: caller-supplied, finite, dimension-compatible, maximum 2,048;
- provider semantic vectors: caller-supplied, finite, dimension-compatible, maximum 3,072 dimensions, model id up to 128 characters, serialized storage capped at 40,000 characters per vector;
- no candidate lane changes prompt limits; selected facts still pass through the existing scorer, selector, and prompt caps.

Semantic input is optional and provider-neutral. Retrieval and its scoring never create an embedding, call an embedding provider, call an LLM, or fall back to a remote service — every candidate lane and scorer only reads vectors that already exist. It consumes a compatible query vector only when the caller already has one and compares it only with stored vectors of the same model and dimension (`src/services/memory/providerSimilarity.ts`, `localSimilarity.ts`). Two independent query vectors can be supplied per turn: the always-available on-device n-gram vector, and an optional provider vector (see below). When both exist for a candidate, provider cosine is the primary semantic signal and lexical overlap is a smaller secondary boost (`factRecallScoring.ts`, `episodes/queryScoring.ts`); when only the on-device vector is available, lexical and semantic scores compete via `Math.max`, unchanged from the pre-provider design.

## Provider-backed semantic lane

The on-device hashed character n-gram vector (`unicode-char-ngram-v1`) cannot recognize a paraphrase or a cross-lingual match — it is a structural fallback, not a semantic model. When the user has an embedding-capable LLM provider enabled, retrieval's semantic signal can instead be a real provider embedding, while remaining fully functional offline and keyless when it is not.

**Provider selection** (`embeddingProviderSelection.ts`) mirrors the existing memory-consolidation provider cascade and tries, in order, the first *enabled* provider of each family: OpenAI (`text-embedding-3-small`), Gemini (`text-embedding-004`), Voyage (`voyage-3-lite`), Mistral (`mistral-embed`), then Ollama (`nomic-embed-text`, using the user's own configured host). OpenAI and Gemini reuse the same API key already configured for chat; Voyage and Mistral are only selected when their own credential resolves to a non-empty key; Ollama is only selected when an enabled Ollama provider entry exists. No dedicated embedding setting exists — selection is entirely derived from the user's existing provider configuration. (OpenRouter also exposes a documented `POST /api/v1/embeddings` endpoint, but wiring it in requires adding `'openrouter'` to the `EmbeddingProvider` union in `src/types/memory.ts` and a corresponding fetcher in `embeddings.ts`; that is a follow-up, not part of this change.)

**Gating.** Provider embedding calls (both the batched fact/episode backfill and the per-turn query embedding) are gated exactly the way the existing memory-consolidation provider setting and the `disableLongTermMemory` opt-out already gate provider calls: `disableLongTermMemory` disables them outright, and memory-consolidation enrichment mode `off` disables them too. No new settings field was introduced.

**Asynchrony and the hot path.** Provider embeddings never run inside retrieval:

- *Fact/episode vectors* are produced only by maintenance — `providerEmbeddingBackfill.ts` (facts) and `providerEpisodeEmbeddingBackfill.ts` (episodes) — invoked from the consolidation scheduler after a turn closes (`consolidatorScheduler.ts`), batched (≤24 items/pass) and rate-limited (`providerEmbeddingRateLimiter.ts`, ≥120 ms between calls). A provider failure on one item is isolated and retried on the next maintenance pass; it never fails the batch.
- *The query vector* is embedded at most once per turn by the memory-access gateway (`memoryAccessGateway.ts`, via `providerQueryEmbedding.ts`), backed by the shared bounded in-memory embedding cache and a hard 1.5 s wall-clock timeout. On any failure, gating, or timeout this resolves to `null` and retrieval proceeds on the on-device lane — it never blocks or degrades a turn waiting on a provider.

**Storage.** Facts store a provider vector in `memory_facts.provider_embedding_{model,dimensions,vector,updated_at}`, mirroring the existing `local_similarity_*` column pattern (`schema.ts`). Episodes reuse the previously-unpopulated `memory_episodes.embedding` column for the serialized vector, paired with new `embedding_model`/`embedding_dimensions`/`embedding_updated_at` columns. A vector is only ever compared against another vector from the exact same `model` — comparing across two different embedding models is never attempted.

**Privacy.** Enabling a provider for consolidation already sends conversation content to that provider; enabling the same provider for memory embeddings additionally sends turn query text (per turn) and stored fact/episode text (once, during backfill) to it for embedding. This is gated identically to consolidation and never happens with `disableLongTermMemory` set or consolidation enrichment off — retrieval remains a fully local, offline, keyless SQLite read in that case.

## Episodic sharing boundary

Automatic cross-thread episode recall is limited to a single durable local vault owner, one root/workspace conversation, and one sealed persona. A newly completed non-task turn may be bound as `session_threads` with `normal` sensitivity only when its root conversation, actual source thread, persona, complete message lineage, and immutable policy are recorded atomically. Task-owned turns are always `thread_only`; private, sensitive, incomplete, expired, deleted, withdrawn, unbound, historical-migration, cross-owner, cross-root, and cross-persona episodes never cross threads.

Current-thread recall is a separate explicit lane and may read an unbound thread-local episode. Missing policy is never interpreted as permission to enter the cross-thread lane. Historical migration writes an explicit `thread_only` policy and does not infer past sharing authorization. Every selected cross-thread origin is re-read and re-authorized against the episode, policy, vault owner, and all source-message/turn withdrawal tombstones before local evidence expansion.

## Measurement and claim guardrails

Per-turn telemetry contains only strategy, semantic availability, lane counts, eligible-scan count, union/diversified counts, and bounded stage timings. It contains no query text, entity/fact/source identifiers, embeddings, or memory content.

The frozen synthetic ablation pairs `lexical` and `hybrid` through the foreground memory-access path for prompt-visible entity, temporal, parity, and eligibility diagnostics. The optional local-semantic pair is component-only because the foreground path does not manufacture or fetch a query vector. It is a public product regression instrument, not held-out evidence, an official benchmark score, a downstream-answer evaluation, or a frontier claim.

Diagnostic targets and guardrails:

1. lexical-control cases retain identical selected IDs and 100% recall at the tested cutoff;
2. hybrid recall at the tested cutoff is at least 20 percentage points above lexical across entity, temporal, and compatible-local-semantic diagnostics; this checked-fixture threshold is explicitly not a release gate;
3. exact scope, historical validity, expiry, deletion, and no-embedding cases pass dedicated regressions;
4. union and lane bounds never overflow, ordering is deterministic, and no extra network/model call occurs;
5. public paired reports expose only aggregate stage counts/timings and fail closed on malformed telemetry.

The report separately exposes scope/expiry/deletion false positives and hybrid-only pollution regressions. It contains no selected fact IDs or memory content. The checked-in synthetic set is frozen by a checked signature after implementation validation. Helpful-memory, completion, release, and frontier claims still require downstream-answer evaluation and evaluator-custodied packs under [the evaluation protocol](./evaluation.md).

The exported runner enumerates every `memory_*` table and refuses unknown cleanup classifications or nonempty evaluation-owned tables. It preserves the explicit vault-identity table, passes one schema-ready database handle through precondition, operation, and cleanup, rejects nested runs, and atomically clears classified evaluation tables in a `finally` boundary after success or failure. It never clears a nonempty user vault; execute it only against an isolated evaluation database.
