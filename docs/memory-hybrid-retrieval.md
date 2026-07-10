# Measured Hybrid Memory Retrieval

Research snapshot: 2026-07-10.

## Product decision

Kavi keeps its local SQLite memory store and provider-neutral request path. Hybrid retrieval is a bounded union of local candidate lanes, not a new memory backend, service, reranking model, or network call. Every lane must apply the existing scope, validity, deletion, expiry, and opt-out rules before a candidate can be ranked.

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

Candidate reasons are closed and content-free: `pinned`, `exact_quoted`, `lexical`, `entity`, `temporal`, and `local_semantic`. A candidate can have multiple reasons and lane ranks. Weighted reciprocal-rank fusion orders the union; one diversity pass protects distinct run, task, turn, conversation, subject, and predicate groups before remaining capacity is filled.

Bounds:

- default union: 128 facts; existing hard maximum: 2,000;
- supplemental eligible scan: 256 facts, hard maximum 500;
- exact/quoted: 24; entity: 32; temporal: 24; local semantic: 32;
- local semantic vectors: caller-supplied, finite, dimension-compatible, maximum 2,048;
- no candidate lane changes prompt limits; selected facts still pass through the existing scorer, selector, and prompt caps.

Semantic input is optional and provider-neutral. Retrieval never creates an embedding, calls an embedding provider, calls an LLM, or falls back to a remote service. It consumes a compatible query vector only when the caller already has one and compares it only with stored vectors of the same dimension.

## Measurement and release gates

Per-turn telemetry contains only strategy, semantic availability, lane counts, eligible-scan count, union/diversified counts, and bounded stage timings. It contains no query text, entity/fact/source identifiers, embeddings, or memory content.

The frozen synthetic ablation uses the same `recallScoredFactsForQuery` path for `lexical` and `hybrid`. It is a product regression instrument, not an official benchmark score. Release targets:

1. lexical-control cases retain identical selected IDs and 100% recall at the tested cutoff;
2. hybrid recall at the tested cutoff is at least 20 percentage points above lexical across entity, temporal, and compatible-local-semantic cases;
3. exact scope, historical validity, expiry, deletion, and no-embedding cases pass dedicated regressions;
4. union and lane bounds never overflow, ordering is deterministic, and no extra network/model call occurs;
5. public paired reports expose only aggregate stage counts/timings and fail closed on malformed telemetry.

The checked-in synthetic set is frozen after implementation validation. It must not be presented as hidden or official held-out evidence; release claims still require evaluator-custodied packs under [the evaluation protocol](./evaluation.md).
