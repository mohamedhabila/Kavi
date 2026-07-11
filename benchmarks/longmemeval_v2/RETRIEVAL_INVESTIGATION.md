# Kavi Memory Retrieval Investigation

Date: 2026-06-26

## Scope

This investigation covers the LongMemEval-V2 readiness failures from:

- `.private/evals/runs/longmemeval-v2/kavi_memory_isolated_readiness_wide_web_4`
- `.private/evals/runs/longmemeval-v2/kavi_memory_isolated_readiness_wide_enterprise_4`

The benchmark adapter isolation passed. Each question used a separate SQLite DB,
inserted 100 trajectories, returned `living_memory/section/0`, and did not
truncate memory context. The failure is retrieval quality.

## Score Evidence

Official harness scores:

| Domain | Questions | Score |
| --- | ---: | ---: |
| web | 4 | 0.0 |
| enterprise | 4 | 0.0 |
| combined sample | 8 | 0.0 |

All memory contexts were non-truncated. The reader mostly answered `UNKNOWN`
because retrieved memory was unrelated to the question.

## Root Cause Trace

1. The adapter ingests official trajectories through `processIngestionTurn`.
2. Each trajectory becomes an episode plus graph-evidence facts.
3. `deterministicExtractor.extractStructuralFacts` also records generic
   tool-result facts such as `longmemeval_state: completed`.
4. `bridgeGraphGoalEvidence` records trajectory/state evidence as facts, but
   the fact text is compact and capped before storage.
5. `recallFactsForQuery` gets candidates via `listFacts({ limit: 500 })`.
   `listFacts` orders by pinned, importance, and `updated_at`, so the scorer
   only sees the newest slice of a larger memory set.
6. Before relevance ranking can fill slots, `selectRecentContextFacts` adds
   recent facts whose `originConversationId` matches the current conversation.
   In this benchmark, all 100 haystack trajectories are intentionally in the
   current conversation, so the newest tail trajectory fills the recall window.
7. Scope and reinforcement boosts are added independently of relevance, so a
   generic conversation fact with zero text relevance can outrank useful facts.
8. `recallRecentEpisodes` is purely recent, so recent unrelated episodes also
   enter the prompt.

Observed collapse:

| Variant | Web top source | Enterprise top source |
| --- | --- | --- |
| current app recall | `2cfe4dab` for all 4 | `72e456ca` for all 4 |
| app text, recency disabled | diversified but still polluted by generic conversation facts | diversified but still polluted by generic conversation facts |
| app simple embedding, latest pool | diversified but limited by newest-pool cap | diversified but limited by newest-pool cap |
| all-facts lexical | diversified and more topical | diversified and more topical |
| all-facts simple embedding | diversified and more topical | diversified and more topical |

Experiment artifacts:

- `.private/evals/runs/longmemeval-v2/retrieval_breakpoint_experiments/*.json`
- `benchmarks/longmemeval_v2/retrieval_experiment.ts`
- `benchmarks/longmemeval_v2/runtimeSimpleEmbeddingsStub.ts`

## On-Device Embedding Research

Viable implementation paths:

- Google AI Edge MediaPipe Text Embedder: on-device text embedding task that
  outputs high-dimensional vectors for cosine similarity:
  <https://ai.google.dev/edge/mediapipe/solutions/text/text_embedder>.
- ONNX Runtime React Native: official React Native runtime path for mobile
  inference:
  <https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html>.
- Transformers.js feature extraction: useful for Node/web experiments and
  potentially web builds, but React Native mobile deployment needs separate
  validation:
  <https://huggingface.co/docs/transformers.js/en/pipelines>.
- Hybrid lexical plus semantic retrieval is a standard production pattern; for
  one concrete reference, Elastic documents combining lexical and semantic
  fields in hybrid search:
  <https://www.elastic.co/guide/en/elasticsearch/reference/current/semantic-text-hybrid-search.html>.
- A local Unicode character n-gram hash embedding is dependency-free and
  language-agnostic. It is not a semantic model, but it is a robust offline
  lexical-vector fallback.

Experiment result: simple local embeddings help only after recall searches the
right candidate universe. They do not fix the current app path by themselves,
because the app path still limits embeddings to the latest candidate pool and
still lets generic scope-boosted facts compete.

## Production Fix Plan

Do not fix this by benchmark-specific filtering. The same failure can happen in
normal chat or agentic workflows during long tasks with many tool calls.

1. Separate semantic recall from recency context.
   - Stop letting recent context facts fill the entire recall limit before
     relevance ranking.
   - Either remove recent-context prefill from semantic recall or cap it to a
     small independent lane.
   - Require relevance evidence before scope/reinforcement boosts can promote a
     fact into semantic memory.

2. Demote or remove generic operational facts from semantic recall.
   - `tool_result: completed` should be episode metadata or low-retrievability
     operational memory, not a normal semantic fact.
   - Extend `RecordFactInput` to persist `retrievability`, `memoryKind`, and
     `stability`, then make recall score use those fields.
   - Simpler option: stop recording generic status-only tool results as facts;
     keep direct memory writes, file operations, and delegated tasks.

3. Replace newest-500 candidate selection with query-aware candidate generation.
   - Pull candidates from multiple lanes: scoped recent facts, lexical/FTS
     matches, vector matches when embeddings exist, pinned facts.
   - Merge and dedupe candidates before final scoring.
   - This must happen at retrieval/query level, not by post-filtering prompt
     rows.

4. Add on-device embedding as an optional local provider.
   - First production path: ONNX Runtime React Native or Google AI Edge text
     embedder behind the existing `EmbeddingConfig` abstraction.
   - Add a dependency-free Unicode n-gram vector fallback for offline lexical
     similarity when the neural embedder is unavailable.
   - Do not enable embeddings without fixing candidate generation and generic
     fact pollution.

5. Make episode recall query-aware.
   - Recent activity should not inject unrelated tail episodes into every
     prompt.
   - Rank episodes by query similarity or include only active-task/thread-local
     recency in a separate, bounded lane.

## Verification Gates

Before a full benchmark run:

1. Unit tests for `factRecall` proving zero-relevance facts cannot win only from
   scope/reinforcement boosts.
2. Unit tests proving recent-context facts cannot consume the full semantic
   recall budget.
3. DB-level retrieval tests with more than 500 facts proving an older relevant
   fact can be surfaced.
4. Benchmark runtime smoke showing per-question isolation still holds.
5. Upstream-protocol LongMemEval mini-run with the same 8 questions:
   - score must improve from 0/8;
   - memory contexts must remain non-truncated;
   - top recalled source trajectories must vary by question;
   - no reader response should hit the max-completion token ceiling.

## Reader Configuration Follow-up

The upstream LongMemEval-V2 runner uses Qwen3.5-9B as the fixed reader with
`temperature=0.6`, `top_p=0.95`, `top_k=20`, `max_completion_tokens=20000`, and
reader thinking enabled. Keep these defaults for official runs.

Targeted experiments on `01f6e679` showed:

| Variant | Result |
| --- | --- |
| official 20K reader cap | Stopped normally below cap; answer can vary because the retrieved context contains an incidental UI helper control. |
| 32K reader cap | Also stopped normally, but still produced the wrong answer in one run; increasing the cap does not fix the semantic failure. |
| 1K reader cap | Hit `length` before content because Qwen spent most of the budget in reasoning. |
| low-temperature 20K | Provider returned an error-style completion with reasoning only. |
| six retrieved memory items | Reproduced a true reader loop that hit the 20K cap by repeating an accessibility-tree label line. |

Conclusion: the default reader is not globally capped too tightly. Low caps can
cause reasoning-only outputs, and higher caps can prolong loops. For malformed or
short reader outputs, inspect provider `finish_reason` with
`benchmarks/longmemeval_v2/diagnose_reader_prompt.py` before changing memory
retrieval or prompt assembly.
