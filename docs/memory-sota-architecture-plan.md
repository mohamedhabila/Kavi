# Kavi SOTA Memory Architecture Plan

Date: 2026-05-15
Status: design complete, live wiring fixes in progress

## 2026-05-15 Investigation Update

The first production investigation after this plan found four concrete causes for
"provider configured but no facts, memories, or focus while chatting":

1. Live completed turns only marked the thread dirty. Durable consolidation still
  waited for the 8-turn threshold, idle timeout, or background flush, so normal
  short chats looked empty.
2. The heuristic working-memory update only ran when no provider was configured.
  Once a provider was selected, the app skipped immediate focus updates until a
  scheduled consolidation actually fired.
3. The default consolidator used an OpenAI-compatible `/chat/completions` call
  directly. Native OpenAI Responses, Anthropic, Gemini, and on-device providers
  could be configured for chat but still fail memory extraction silently.
4. Structured SQLite writes did not publish memory-change notifications, so the
  sidebar and Memory screen could stay stale even after facts or working blocks
  were written.

The live fix is to consolidate every completed chat turn through the same native
provider transport as conversation replies, update heuristic focus immediately,
emit structured memory-change events from all fact/block writes, and open the
Memory screen on structured facts/search by default. The remaining phases below
should build on that fixed baseline rather than restoring the legacy file-backed
memory path.

## Executive Summary

Kavi already has the right foundation for a serious long-term memory system:
SQLite-backed facts, entities, scoped working blocks, episodes, evidence rows,
hybrid chunk search, prompt-time recall, decay-aware scoring, and lifecycle
hooks. The implementation is not yet behaving like product-critical human-like
memory because the system is still too optional, too hidden, and too dependent
on a configured consolidation provider.

The target architecture is an always-on, mode-agnostic memory system for one
continuous conversation. It should continuously accumulate memories in both
chitchat and agentic mode, keep the current task and recent activity in context,
decay older memories without deleting their evidence, and require search or
explicit recall for old or weak memories. The product should make memory visible:
today's focus, current task, recent memories, pinned moments, and searchable old
episodes must be live surfaces, not dormant tabs.

The implementation plan below keeps the existing SQLite stack and upgrades it
into a layered memory architecture inspired by human memory and current 2026
agent-memory research.

## Current Implementation Review

### What Exists

- `src/services/memory/schema.ts` creates tables for entities, facts, memory
  blocks, scoped working blocks, consolidation state, migration state, episodes,
  and fact evidence.
- `src/services/memory/facts.ts` stores bi-temporal facts with scope,
  provenance, confidence, importance, access counters, reinforcement timestamps,
  decay policy, expiry, pinning, supersession, and invalidation.
- `src/services/memory/episodes.ts` stores compact episode summaries and indexes
  episode summaries into `memory_chunks` for persistent search.
- `src/services/memory/consolidator.ts` extracts durable facts, invalidations,
  episode summaries, `active_focus`, `open_threads`, and notable lines from a
  completed turn window.
- `src/services/memory/consolidatorScheduler.ts` triggers consolidation after a
  turn threshold, idle threshold, app background flush, or manual trigger.
- `src/services/memory/lifecycle.ts` records completed turns, runs migration
  seeding, flushes dirty threads, and falls back to heuristic focus/open-thread
  updates when no consolidator provider is configured.
- `src/services/memory/livingMemoryBridge.ts` appends memory blocks, focus, and
  retrieved facts to the orchestrator prompt.
- `src/services/memory/factRecall.ts` scores recall with vector similarity,
  lexical overlap, scope boost, temporal decay, confidence, importance,
  reinforcement, pinning, and MMR-style diversification.
- `src/screens/MemoryScreen.tsx` exposes global/daily legacy memory plus Facts
  and Blocks tabs.
- `src/components/sidebar/SidebarMemorySections.tsx` surfaces today's focus,
  open threads, recall entry, and pinned moments in the drawer.
- `src/screens/SettingsScreen.tsx` exposes a long-term-memory opt-out and a
  memory consolidation provider selector.

### Why Memory Feels Under-Utilized

1. Durable memory extraction is effectively opt-in. `consolidationProvider`
   defaults to `null`, so fact and episode creation mostly does not happen until
   the user selects a provider. The fallback updates working blocks but does not
   create durable facts.
2. The default scheduler is conservative. A user can have several meaningful
   turns and still see no facts because consolidation waits for threshold,
   idle, or background triggers.
3. Chitchat and agentic turns share the final lifecycle hook, but durable
   memory quality depends on provider-gated consolidation. Chitchat needs the
   same first-class accumulation path as agentic work.
4. The app is one conversation, but memory is mostly scoped by conversation id.
   Since one conversation can contain many tasks, topics, people, and projects,
   Kavi needs task/topic segmentation inside the canonical thread.
5. Sidebar memory reads are not live enough. The current memory section readers
   use mount-time reads, so focus and pinned facts can stay stale until a remount
   or navigation event.
6. The sidebar recall input ignores the query after navigation. It opens the
   Memory screen but does not seed a structured recall search.
7. The Memory screen defaults to legacy file-backed global notes. Structured
   facts, blocks, episodes, focus, and search are secondary, so users do not see
   what the current memory system is doing.
8. "Today's focus" is currently the most recent scoped `active_focus` block,
   not a real day-level focus summary with task stack, resumption cues, and
   active objectives.
9. Old memories are indexed, but there is no user-visible "remembering" flow
   that explains retrieval, decay, invalidation, or why a memory did or did not
   enter context.
10. There is no continuous memory inbox, review queue, or health telemetry. When
    memory is empty, stale, or provider-blocked, the product gives little useful
    feedback.

## External Research Findings

### Human Memory Principles To Model

- Multi-store memory: Atkinson-Shiffrin separates brief sensory buffers,
  short-term/working memory, and long-term memory. Attention controls what moves
  forward, and unattended material decays quickly.
- Working memory: Baddeley's model treats working memory as a central executive
  plus modality buffers and an episodic buffer that binds information with time
  and long-term knowledge. For Kavi, this maps to current focus, task stack,
  recent turns, attachments, and active tools.
- Episodic vs semantic memory: Human memory separates event memories from
  generalized facts. Kavi should preserve raw/grounded episodes while deriving
  semantic facts and preferences from them.
- Encoding specificity: memories are easier to retrieve when retrieval cues
  match the original encoding context. Kavi should store speaker, task, project,
  time, tool, source message, and entity cues with each memory.
- Forgetting is retrieval degradation, not just deletion. Older memories should
  lose prompt priority unless reinforced, searched, pinned, or made newly
  relevant. Evidence should remain available for search and audit.
- Reinforcement and spacing matter. Repeated mentions, successful retrievals,
  and explicit user confirmations should strengthen a memory and extend its
  half-life.
- Reconsolidation matters. When a memory is recalled or contradicted, it can be
  updated. Kavi should invalidate or supersede old facts instead of mutating
  history in place.
- Sleep/offline replay is a useful system analogy. Expensive consolidation
  should happen after turns, during idle windows, and on background, not inside
  the latency-critical response path.

### Agent Memory Research And Best Practices

- MemGPT (2023/2024) frames long context as virtual memory: a fast context
  window plus slower archival memory, with explicit memory management and
  interrupts.
- Generative Agents (2023) introduced memory streams with retrieval by recency,
  importance, and relevance, plus reflection to form higher-level summaries.
- MemoryBank (2023) uses continuous updates and Ebbinghaus-inspired forgetting
  and reinforcement for long-term chatbot memory.
- Graphiti/Zep emphasizes temporal knowledge graphs, episodic ingestion,
  provenance, hybrid semantic/full-text/graph search, and temporal invalidation
  for changing facts.
- Mem0's 2026 research page emphasizes token-efficient memory, single-pass
  add-only extraction, multi-signal retrieval, temporal abstraction,
  cross-session structure, and agent-native asynchronous memory.
- The 2026 ACL survey "From Storage to Experience" frames memory evolution as
  storage, reflection, then experience: preserving trajectories, refining them,
  and abstracting across trajectories.
- LightMem (ACL 2026) separates online retrieval from offline consolidation and
  uses small language models for retrieval, writing, and long-term consolidation
  under bounded compute.
- MemMachine (2026) argues for preserving ground-truth conversational episodes
  and expanding retrieval around nucleus matches rather than relying only on
  lossy extracted summaries.
- MemORAI (ACL Findings 2026) combines selective memory filtering, dual-layer
  compression, provenance-rich multi-relational graphs, and query-adaptive
  subgraph retrieval.
- GroupMemBench (May 2026) shows memory systems collapse in group-like settings
  when speaker grounding, term ambiguity, knowledge update, and audience context
  are erased. Even a single-user app should store speaker/actor and audience
  fields because agents, tools, and sub-agents create multi-actor traces.
- Memora/FAMA (ACL Findings 2026) shows long-term memory systems often reuse
  obsolete memories. Evaluation must penalize reliance on invalidated memories,
  not only reward recall.

## Target Architecture

### Design Goals

1. Always accumulate memory while long-term memory is enabled.
2. Work identically for chitchat and agentic modes.
3. Keep the current task, focus of day, and recent memory in context.
4. Make old memories searchable and recallable, but not always prompt-resident.
5. Decay memory retrievability over time while preserving evidence.
6. Treat corrections as first-class invalidations and reconsolidation events.
7. Preserve source episodes so extracted facts can be audited and repaired.
8. Be local-first and privacy-explicit; network-assisted consolidation must be
   configurable and visible.
9. Make memory visible in the UI and measurable in tests.

### Memory Layers

Layer 0: Raw Trace
- Source: every user, assistant, tool, agent, attachment, and voice transcript
  event.
- Purpose: ground truth, audit, replay, and extraction source.
- Persistence: existing conversation messages plus new episode source windows.

Layer 1: Working Memory
- Source: latest turn, current task, active focus, open loops, foreground tools.
- Lifetime: minutes to one day unless reinforced.
- Prompt behavior: always eligible for the next turn.
- Existing base: `memory_working_blocks`.
- Needed upgrade: task/topic-scoped working blocks inside the canonical thread.

Layer 2: Episodic Memory
- Source: completed turn windows and agent workflow milestones.
- Contents: compact episode summary, source message ids, tools, entities,
  timestamps, task/topic id, importance, raw excerpt boundaries.
- Prompt behavior: recent episodes enter context directly; older episodes need
  retrieval.
- Existing base: `memory_episodes` and `memory_chunks`.

Layer 3: Semantic Fact Graph
- Source: extracted facts, user corrections, tool evidence, repeated mentions.
- Contents: entities, predicates, relationships, valid/invalid intervals,
  confidence, provenance, source actor, audience, importance, decay parameters.
- Prompt behavior: retrieved facts enter context with source and validity.
- Existing base: `memory_entities`, `memory_facts`, `memory_fact_evidence`.
- Needed upgrade: relationship/edge table and speaker/audience metadata.

Layer 4: Profile And Preferences
- Source: stable user preferences, identity details, durable project facts,
  assistant style constraints, explicit pins.
- Prompt behavior: high-confidence pinned profile/preferences enter the cacheable
  prompt prefix; uncertain preferences remain retrieved facts.
- Existing base: global memory blocks plus facts with `global`, `project`, or
  `persona` scopes.

Layer 5: Reflective Schemas
- Source: daily/weekly consolidation and cross-task abstraction.
- Contents: focus of the day, recurring projects, long-running goals, routines,
  unresolved themes, known contradictions.
- Prompt behavior: short day focus and current schema enter context; older
  schemas are searchable.

## Proposed Data Model Changes

Add or extend these tables in `src/services/memory/schema.ts`:

1. `memory_ingestion_jobs`
   - `id`, `thread_id`, `task_id`, `source_start_message_id`,
     `source_end_message_id`, `reason`, `status`, `attempt_count`, `error`,
     `created_at`, `updated_at`, `completed_at`.
   - Purpose: always enqueue consolidation without blocking chat.

2. `memory_tasks`
   - `id`, `thread_id`, `title`, `state`, `started_at`, `last_active_at`,
     `ended_at`, `parent_task_id`, `summary`, `embedding`, `confidence`.
   - Purpose: segment one canonical conversation into task/topic episodes.

3. `memory_edges`
   - `id`, `source_entity_id`, `predicate`, `target_entity_id`, `object_text`,
     `valid_at`, `invalid_at`, `confidence`, `source_fact_id`, `source_episode_id`,
     `created_at`, `deleted_at`.
   - Purpose: graph recall and relationship traversal while preserving facts.

4. Extend `memory_facts`
   - `source_actor_id`, `audience_id`, `task_id`, `retrievability`, `stability`,
     `decay_rate`, `last_presented_at`, `last_confirmed_at`, `last_conflicted_at`,
     `review_state`, `sensitivity`, `memory_kind`.
   - Purpose: human-like decay, explicit review, speaker grounding, and policy.

5. Extend `memory_episodes`
   - `source_start_message_id`, `source_end_message_id`, `task_id`,
     `grounding_checksum`, `raw_excerpt`, `review_state`.
   - Purpose: ground-truth-preserving retrieval and repair.

6. `memory_reflections`
   - `id`, `scope`, `thread_id`, `task_id`, `period_start`, `period_end`,
     `kind`, `content`, `source_episode_ids`, `source_fact_ids`, `created_at`,
     `updated_at`, `deleted_at`.
   - Purpose: focus of day, weekly project summaries, and schemas.

7. `memory_retrieval_log`
   - `id`, `thread_id`, `task_id`, `query`, `selected_fact_ids`,
     `selected_episode_ids`, `selected_reflection_ids`, `scores_json`,
     `prompt_tokens_estimate`, `created_at`, `used_in_response`.
   - Purpose: observability, UI explanation, and evaluation.

## Runtime Pipeline

### Ingestion

1. On every completed assistant turn, call a mode-agnostic memory recorder.
2. Synchronously update Layer 1 working memory with a cheap deterministic or
   heuristic summarizer so today's focus appears immediately.
3. Enqueue a `memory_ingestion_jobs` row for the completed source window.
4. Run the ingestion queue during idle/background and opportunistically after
   response finalization.
5. Use a provider strategy:
   - first: explicit memory consolidation provider if set;
   - second: local/on-device small model when available;
   - third: active chat provider with clear Settings copy;
   - fourth: deterministic heuristic extraction for focus, task title,
     obvious preferences, and explicit "remember" statements.
6. Persist episodes before extracted facts. Facts must point back to evidence.
7. Apply add-only extraction for new facts, then run contradiction/invalidation
   separately so prior evidence remains auditable.
8. Reinforce duplicates instead of creating noise.

### Retrieval

1. Build a retrieval query from the latest user message, active task, recent
   entities, current mode, tool context, and explicit memory intent.
2. Always include:
   - current working block for active task;
   - focus of day;
   - last few high-signal episodes from the active task;
   - pinned profile/preferences.
3. Retrieve candidates using parallel signals:
   - vector similarity;
   - BM25 or lexical match;
   - entity/name match;
   - graph expansion around matched entities;
   - temporal match for dates and recency;
   - task/thread proximity.
4. Rerank candidates by semantic consistency, temporal validity, speaker/task
   match, confidence, retrievability, importance, reinforcement, and novelty.
5. Filter invalidated facts unless the user asks historical or contradiction
   questions.
6. Use MMR/diversity to avoid dumping many variants of the same fact.
7. Emit a compact prompt block with source labels and validity, not raw scores.
8. Log retrieval decisions to `memory_retrieval_log`.

### Decay And Reinforcement

Use a stability/retrievability model:

- `retrievability` falls with age since `last_recalled_at` or
  `last_reinforced_at`.
- `stability` increases with explicit confirmation, repeated mention,
  successful retrieval, pinning, and high importance.
- `decay_rate` is faster for ephemeral task details and slower for stable
  identity, preferences, and pinned memories.
- Decayed memories stay searchable, but they lose default prompt priority.
- Corrections set `invalid_at` and `last_conflicted_at`, then create a new fact.
- A recalled memory can be reconsolidated: if used and confirmed, reinforce; if
  contradicted, invalidate; if partially changed, create a successor relation.

### Prompt Budgeting

The prompt should remain layered:

1. Stable system prompt.
2. Stable profile/preferences and pinned facts.
3. Dynamic focus of day, active task, recent episodes, and retrieved facts.
4. Current user turn and attachments.

Budget rules:

- Layer 1/2 memory must be compact and cache-friendly.
- Dynamic memory should have a hard token cap and per-kind caps.
- Old facts must not crowd out current task state.
- If retrieval is uncertain, prefer a tool-callable recall/search path over
  injecting weak memory into the prompt.

## Product UX Requirements

1. Memory Home should default to structured memory, not legacy global markdown.
2. The first screen should show:
   - Today's focus;
   - Current task;
   - Recent memories captured today;
   - Open loops;
   - Pinned profile/preferences;
   - Search old memory.
3. Sidebar memory sections must subscribe to memory changes and re-render when
   working blocks, facts, or reflections change.
4. Sidebar recall search must pass the query into MemoryScreen and immediately
   run structured recall/search.
5. Memory rows should show why they exist: source turn, confidence, last used,
   valid/invalid status, and controls to pin, forget, correct, or inspect source.
6. Focus of day should be generated from daily reflections and active task
   state, not just the latest `active_focus` block.
7. If durable consolidation is disabled, unconfigured, or failing, the UI should
   say so and show the fallback path rather than silently appearing empty.

## Implementation Plan

### Phase 0: Visibility And Critical Fixes

Goal: make existing memory visible and live before changing the deeper stack.

Files:
- `src/components/sidebar/SidebarMemorySections.tsx`
- `src/screens/MemoryScreen.tsx`
- `src/navigation/*`
- `src/services/memory/store.ts`
- `src/services/memory/workingBlocks.ts`
- `src/services/memory/facts.ts`

Tasks:
- Add a memory change subscription for structured memory writes, not just legacy
  file-backed memory.
- Trigger sidebar re-reads when facts or working blocks change.
- Wire sidebar recall query into MemoryScreen route params.
- Default MemoryScreen to a new Overview tab with focus, recent facts, blocks,
  and search.
- Add visible status for `consolidationProvider === null`: "working focus is on;
  durable fact consolidation needs a provider or local model."
- Add tests proving focus appears after a completed turn without remount.

Acceptance:
- After one completed turn, sidebar focus updates live.
- Recall search opens MemoryScreen with results for the typed query.
- A user can see whether durable consolidation is active.

### Phase 1: Always-On Ingestion Queue

Goal: every completed turn creates memory work in both chitchat and agentic mode.

Files:
- `src/services/memory/schema.ts`
- `src/services/memory/lifecycle.ts`
- `src/services/memory/consolidatorScheduler.ts`
- new `src/services/memory/ingestionQueue.ts`
- `src/screens/ChatScreen.tsx`
- `src/services/startup.ts`

Tasks:
- Add `memory_ingestion_jobs`.
- Enqueue a job for every completed assistant turn with source window ids.
- Process jobs after final response, on idle, foreground, and background.
- Keep synchronous heuristic working-memory update for immediate focus.
- Make the old threshold scheduler an optimization, not the only durable path.

Acceptance:
- Chitchat turn creates a pending/completed memory job.
- Agentic turn creates a pending/completed memory job.
- Jobs resume after app restart.
- Chat response latency does not wait on provider extraction.

### Phase 2: Provider Strategy And Local Fallback

Goal: stop treating memory as off unless a special provider is selected.

Files:
- `src/services/memory/lifecycle.ts`
- new `src/services/memory/providerStrategy.ts`
- `src/store/useSettingsStore.ts`
- `src/screens/SettingsScreen.tsx`
- `src/i18n/locales/*`

Tasks:
- Add `memoryConsolidationMode`: `auto`, `local`, `active_provider`,
  `specific_provider`, `off`.
- Default to `auto` when long-term memory is enabled.
- In `auto`, prefer local SLM/on-device extraction when available, otherwise
  active provider if the user has allowed provider-assisted memory.
- Keep `disableLongTermMemory` as the hard privacy kill switch.
- Add explicit Settings copy explaining when snippets leave device.

Acceptance:
- A default install accumulates visible working memory immediately.
- Durable facts can accumulate without the user discovering a hidden provider
  selector, subject to the privacy setting.
- Opt-out prevents all reads, writes, extraction, and migration.

### Phase 3: Task Segmentation Inside The Canonical Thread

Goal: make one conversation behave like many human tasks without losing global
continuity.

Files:
- `src/services/memory/schema.ts`
- new `src/services/memory/tasks.ts`
- `src/services/memory/consolidator.ts`
- `src/services/memory/livingMemoryBridge.ts`

Tasks:
- Add `memory_tasks`.
- Detect task/topic shifts from user messages, tools, workspace ids, and agent
  run metadata.
- Attach working blocks, episodes, facts, and retrieval logs to a task id.
- Render active task and open loops in the focus block.
- Let side threads inherit parent task context without polluting active task.

Acceptance:
- A single long conversation can hold multiple tasks with separate active focus
  and open loops.
- Returning to an old task retrieves that task's recent episodes and facts.

### Phase 4: Ground-Truth-Preserving Episodes

Goal: prevent lossy summaries from becoming the only memory source.

Files:
- `src/services/memory/episodes.ts`
- `src/services/memory/sqlite-store.ts`
- `src/services/memory/consolidator.ts`
- `src/services/memory/factRecall.ts`

Tasks:
- Store episode source boundaries and raw excerpt/checksum.
- Index both summary and excerpt chunks with source metadata.
- Add contextual retrieval expansion: when a chunk matches, include neighboring
  messages or the containing episode summary.
- Expose source inspection in MemoryScreen.

Acceptance:
- Retrieved memories can show their exact source turn.
- A fact can be audited back to evidence.
- Multi-turn evidence is recoverable when a query match lands in the middle of
  an episode.

### Phase 5: Graph And Multi-Signal Retrieval

Goal: retrieve like memory, not only like vector search.

Files:
- `src/services/memory/schema.ts`
- new `src/services/memory/graph.ts`
- `src/services/memory/factRecall.ts`
- `src/services/memory/livingMemoryBridge.ts`
- `src/engine/tools/parity-memory.ts`

Tasks:
- Add `memory_edges` for entity relationships.
- Extract edges from facts and episodes.
- Add BM25/lexical, entity, graph-neighborhood, vector, temporal, and task
  proximity candidate sources.
- Add semantic consistency reranking with a local heuristic first and provider
  reranker optional later.
- Add retrieval explanations for UI and telemetry.

Acceptance:
- Preference, entity, temporal, multi-hop, and old-memory questions retrieve
  different but appropriate candidate sets.
- Invalidated facts are excluded from normal recall.
- Search can answer "what were we doing yesterday?" using episodes/reflections.

### Phase 6: Decay, Reinforcement, And Reconsolidation

Goal: old memories fade from context but remain recoverable.

Files:
- `src/services/memory/facts.ts`
- `src/services/memory/factRecall.ts`
- new `src/services/memory/decay.ts`
- `src/services/memory/consolidator.ts`

Tasks:
- Add stability/retrievability fields and update functions.
- Reinforce repeated mentions, explicit confirmations, pins, and successful
  retrievals.
- Decay prompt priority for unreinforced task details.
- Invalidate contradictions before successor fact creation.
- Add historical recall mode for "what did I used to think/prefer?".

Acceptance:
- Recent task state is in prompt by default.
- Old, weak memories require search or explicit recall.
- Corrected memories do not leak into normal answers.
- Pinned memories do not decay out of prompt eligibility.

### Phase 7: Focus Of Day And Reflective Memory

Goal: make focus useful and human-like.

Files:
- new `src/services/memory/reflections.ts`
- `src/services/memory/focus.ts`
- `src/services/memory/livingMemoryBridge.ts`
- `src/components/sidebar/SidebarMemorySections.tsx`
- `src/screens/MemoryScreen.tsx`

Tasks:
- Add daily focus reflection from today's episodes, open tasks, and pinned goals.
- Create weekly/project reflections during idle/background.
- Render focus of day separately from latest active focus.
- Add "resume" cues after long gaps.

Acceptance:
- The app shows a meaningful focus of day after ordinary use.
- Returning after hours/days produces a concise resumption cue.
- Focus updates when tasks resolve.

### Phase 8: Evaluation And Memory Health

Goal: make memory regressions measurable.

Files:
- `__tests__/integration/memory-scenarios.test.ts`
- new `__tests__/integration/memory-humanlike-scenarios.test.ts`
- new `scripts/memory-eval-harness.mjs`

Tasks:
- Add benchmark-inspired local scenarios:
  - chitchat preference capture;
  - agent task outcome capture;
  - focus after one turn;
  - old memory search after decay;
  - correction/invalidation;
  - task switch inside one canonical thread;
  - multi-actor tool/sub-agent provenance;
  - opt-out privacy.
- Add FAMA-style metric: penalize answers or prompt context that use invalidated
  facts.
- Add retrieval precision, recall, latency, prompt-token, and stale-memory
  counters.

Acceptance:
- CI catches empty-memory regressions.
- CI catches obsolete-memory leakage.
- Retrieval remains within mobile latency and token budgets.

## Implementation Order

1. Phase 0: visibility fixes. This directly addresses the user-visible issue.
2. Phase 1: always-on ingestion queue.
3. Phase 2: provider strategy and local fallback.
4. Phase 3: task segmentation.
5. Phase 4: ground-truth-preserving episodes.
6. Phase 6: decay/reinforcement/reconsolidation.
7. Phase 5: graph retrieval. This can overlap with Phase 4 after provenance is
   in place.
8. Phase 7: focus of day and reflections.
9. Phase 8: benchmark harness and memory health dashboard.

## Minimum Viable SOTA Cut

If implementation must be sliced tightly, ship this first:

1. Live sidebar subscription and Memory Overview tab.
2. Always-on ingestion queue with immediate heuristic focus update.
3. Auto provider strategy instead of hidden `consolidationProvider === null`.
4. Task id attached to working blocks, episodes, facts, and recall.
5. Retrieval query seeded by active task plus latest user message.
6. Decay/reinforcement fields with invalidated-fact filtering and FAMA-style
   tests.

This would make memory visible, continuous, and safer before adding richer graph
retrieval.

## Acceptance Checklist

- [ ] A normal chitchat turn can create visible working memory immediately.
- [ ] A normal chitchat turn can create durable facts/episodes when memory
      consolidation is available.
- [ ] An agentic task outcome is recorded as an episode and durable facts.
- [ ] Today's focus appears and updates without navigating away.
- [ ] The current task and recent memory are included in prompt context.
- [ ] Old memories decay from default context but remain searchable.
- [ ] Corrected memories are invalidated and excluded from normal retrieval.
- [ ] Sidebar recall search opens populated results.
- [ ] MemoryScreen shows structured memory first.
- [ ] Opt-out blocks all memory reads, writes, provider calls, migration, and
      tools.
- [ ] Retrieval logs explain why each memory entered context.
- [ ] Tests cover chitchat, agentic, task-switch, decay, recall, correction,
      and opt-out flows.

## Source Notes

- MemGPT: https://arxiv.org/abs/2310.08560
- Generative Agents: https://arxiv.org/abs/2304.03442
- MemoryBank: https://arxiv.org/abs/2305.10250
- Graphiti overview: https://help.getzep.com/graphiti/graphiti/overview
- Mem0 2026 research page: https://mem0.ai/research
- From Storage to Experience survey: https://arxiv.org/abs/2605.06716
- LightMem: https://arxiv.org/abs/2604.07798
- MemMachine: https://arxiv.org/abs/2604.04853
- MemORAI: https://arxiv.org/abs/2605.01386
- GroupMemBench: https://arxiv.org/abs/2605.14498
- From Recall to Forgetting / FAMA: https://arxiv.org/abs/2604.20006
- PubMed memory systems search: https://pubmed.ncbi.nlm.nih.gov/?term=human+memory+systems+working+episodic+semantic+review
- PubMed systems consolidation search: https://pubmed.ncbi.nlm.nih.gov/?term=memory+consolidation+hippocampus+neocortex+systems+consolidation+review
- PubMed sleep and replay search: https://pubmed.ncbi.nlm.nih.gov/?term=sleep+memory+consolidation+review+hippocampal+replay
- PubMed reconsolidation search: https://pubmed.ncbi.nlm.nih.gov/?term=reconsolidation+human+memory+review
- PubMed spacing/retrieval practice search: https://pubmed.ncbi.nlm.nih.gov/?term=spacing+effect+retrieval+practice+memory+review