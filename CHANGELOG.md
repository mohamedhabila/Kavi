# Changelog

All notable changes to Kavi will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning where practical for tagged releases.

## [Unreleased]

### Added

- Phase 161 — Chunk P (Closure to 100%): the remaining redesign deltas
  identified in the Chunk O follow-up audit are now shipped.
  - Settings → Data exposes a **Memory consolidation provider** chip
    selector. Users can pick any enabled provider (or "Off") and the
    selection drives `setConsolidationProvider`, which the lifecycle
    tick and background flush already consume. Without this UI the
    consolidator pipeline silently no-opped in production. New i18n
    keys (`memory.consolidationProvider`, `memory.consolidationProviderHint`,
    `memory.consolidationProviderOff`) are mirrored across all 9
    locales.
  - Sidebar header replaces the prominent `+` button with a
    **MoreVertical** overflow that opens a "Thread options" sheet
    containing **Start a side thread**, matching plan §4.8 ("There is
    no 'new conversation' button. There is a 'Start a side thread'
    affordance ... in an overflow menu."). Side threads always branch
    off the canonical main thread; if no canonical thread exists yet
    we materialise it before branching. New `nav.threadOptions`,
    `nav.startSideThread`, `nav.startSideThreadHint` keys mirrored
    across all 9 locales; `nav.noConversationsHint` updated to point
    users at Today's focus / recall instead of the removed `+` button.
  - MemoryScreen now renders a one-line **attribution footer**
    ("Inspired by MemGPT, Graphiti, and mem0.") per plan §8. New
    `memory.attribution` key mirrored across all 9 locales.
  - `_research/PRIVACY_POLICY_DRAFT_20260417.md` gains a dedicated
    **Long-Term Memory** section that documents `memory_facts` /
    `memory_entities` / `memory_blocks`, the soft-delete vs hard-delete
    distinction, the audit trail recorded per fact, and the
    opt-out toggle wiring.

### Added

- Phase 161 — Chunk O (Privacy & rollout closure): single-thread memory
  redesign now ships its end-to-end privacy and lifecycle wiring.
  - Settings → Data now exposes a "Disable long-term memory" toggle
    (`useSettingsStore.disableLongTermMemory`). When enabled, the
    living-memory bridge skips block reads and recall, the consolidator
    scheduler bails before extractor calls (`skipped: 'opt_out'`), the
    background flush returns zero counters, the migration seed pass is a
    no-op, and every `memory_*` engine tool returns
    `{ ok: false, code: 'permission_denied' }` so the agent can react
    gracefully.
  - New `src/services/memory/lifecycle.ts` wires `runMigrationSeedPass`
    and `flushAllDirtyThreads` into the app shell: launch + each
    foreground throttle-tick the migration seed runner (30s cooldown)
    and each background event flushes dirty consolidator threads. The
    default extractor calls the user's `consolidationProvider` over
    `/v1/chat/completions` (OpenAI-compatible); misconfigured providers
    no-op cleanly.
  - New `src/components/MigrationProgressBanner.tsx` renders in the
    sidebar while the v6→v7 archived-thread backfill is draining,
    polling `listMigrationStates()` every 5s and dismissable. Reuses
    the already-shipped `memory.migrationSeed{Title,Progress,Complete}`
    keys across all 9 locales.
  - New `_research/memory-load-harness.mjs` performance harness
    asserting consolidator 8-turn batch < 1500ms and recall over 10k
    facts < 80ms.
  - Coverage: 5 new lifecycle tests, 4 banner tests, 8-tool opt-out
    parameterized test, plus opt-out cases on
    `livingMemoryBridge` / `maybeRunConsolidation` /
    `flushAllDirtyThreads`. Full suite green at 272 suites / 4647
    tests / 0 regressions.

### Added

- Plan §7 integration tests (phase 161 — Chunk N): new
  `__tests__/integration/memory-scenarios.test.ts` stitches the memory
  subsystem (fact store + consolidator scheduler + recall + focus block +
  prompt assembly) end-to-end with deterministic fake LLM extractors.
  Covers the three scenarios called out in
  `_research/SINGLE_THREAD_MEMORY_REDESIGN_20260429.md` §7: a 200-message
  thread that fires consolidation at the expected cadence, keeps the
  assembled prompt under a 12k-char regression guard, and surfaces the
  right fact at "turn 250" via recall; an 8-hour return-of-user gap that
  produces the `later_today` focus bucket with a "back later today" cue
  and still recalls the prior topic; and a contradiction-supersession
  scenario where a new fact with the same `(subject, predicate)` invalidates
  the prior row, recall returns only the new value, the bi-temporal
  `asOf` query still surfaces the historical row, and a replay is a
  content-hash dedupe no-op. 4 new tests; 0 LLM traffic.
- Migration consolidation seed pass + opt-out (phase 161 — Chunk M): new
  `src/services/memory/migrationSeedPass.ts` walks each conversation flagged
  `archivedFromMigration: true` (from the v6→v7 collapse) and replays its
  user→assistant turn pairs through the existing consolidator pipeline so
  long-lived facts surface in the unified memory. The runner is **resumable**
  (per-conversation cursor persisted in a new `memory_migration_state` table
  added to `ensureFactSchema`), **throttled** (defaults: 8 conversations per
  call, 4 turn pairs per conversation), **fail-safe** (per-conversation
  errors capture but never halt the batch), and **idempotent** (existing
  `recordFact` content_hash dedupe). New settings flag `disableLongTermMemory`
  (default `false`) added to `AppSettings` + `useSettingsStore` (persist
  version bumped 10 → 11) — when on, the seed pass is a no-op and today's
  stateless-per-conversation behaviour is preserved (Plan §10 privacy
  opt-out). Translations added for all nine locales
  (`memory.disableLongTermMemory`, `disableLongTermMemoryHint`,
  `migrationSeedTitle`, `migrationSeedProgress`, `migrationSeedComplete`).
  Settings UI toggle and migration progress banner are intentionally
  deferred to a later UI chunk; the seed-pass module ships ready to be
  driven by either UI or a startup hook. 20 new unit tests cover turn
  pairing (system/tool skips, anchor cursor, empty-side rejection),
  per-conversation seeding (cap + resume, error capture, recovery,
  short-circuit on completed), the multi-conversation runner
  (`disableLongTermMemory` opt-out, missing extractor no-op, oldest-first
  ordering, error continuation, skip-completed), and state CRUD.
- Sidebar IA refresh (phase 161 — Chunk L): the drawer now leads with four
  memory-driven sections rendered above the conversation list — **Today's
  focus** tile (reads the `active_focus` block), **Open threads** chips
  (parsed from the `open_threads` block), **Recall** search input (opens the
  Memory screen), and **Pinned moments** (top user-pinned facts). The
  conversation list is grouped into collapsible **Today / Yesterday / This
  week / Earlier** time buckets driven by `bucketConversationsByTime`. New
  module `src/components/sidebar/SidebarMemorySections.tsx` exports the
  building blocks. Memory reads are guarded so an uninitialised SQLite store
  degrades gracefully to empty-state copy. Translations added for all nine
  locales (`todaysFocus`, `openThreads`, `pinnedMoments`, `recallPlaceholder`,
  `recallSearch`, `byTimeToday`/`Yesterday`/`ThisWeek`/`Earlier` and matching
  empty hints).
- Memory consolidation scheduler (phase 161 — Chunk K): new
  `src/services/memory/consolidatorScheduler.ts` decides per-thread when to
  run `consolidateTurn`. Triggers: ≥ 8 new user/assistant turns since the
  last anchor, ≥ 10 minutes idle since the last assistant message, or an
  explicit app-background flush. Per-thread cursors live in a new
  `memory_consolidation_state` SQLite table (`last_consolidated_message_id`,
  `turns_since_last`, `last_consolidated_at`). The scheduler is gated by a
  new opt-in `consolidationProvider` setting on `AppSettings` (defaults to
  `null` — on-device-only users keep today's stateless behaviour). When the
  setting is unset the scheduler still tracks dirty turn counts so that
  later-configured providers can flush the backlog. `flushAllDirtyThreads()`
  is wired for `AppState` background-transition fan-out (caller-driven).
- Living-memory orchestrator wiring (phase 161 — Chunk J): the previously dormant
  `assemblePrompt()`, `renderFocusBlock()` and `recallFactsForQuery()` helpers now
  actually fire on every live request. A new `livingMemoryBridge` module reads the
  pinned memory blocks (L2), renders the focus block from the latest assistant/user
  timestamps + the `active_focus`/`open_threads` blocks, runs per-turn fact recall
  (lexical-only fallback when no embedder is configured), and appends the resulting
  cacheable L2 + dynamic L3 sections to the orchestrator's system-prompt array. The
  same bridge output is fed into the compaction engine as `idleSinceLastTurnMs`,
  `focusBlock`, and `openThreads` so tier-2/tier-3 summaries inherit the living
  context (Plan §6.1–§6.4).
- Living-memory subsystem (phase 161): persistent fact store with three layered tiers
  (core/recall/episodic), a derived pinned-focus list, focus-header injection into the
  system prompt, deterministic on-demand consolidation, and an evidence bridge that
  surfaces the active fact set to the agent runtime
- 7 new memory orchestration tools (`memory_recall`, `memory_remember`, `memory_pin`,
  `memory_unpin`, `memory_forget`, `memory_block_read`, `memory_block_edit`) wired
  through the parity tool catalog with definitions, dispatch, and the `memory`
  category guidance. Pure underlying executors live in
  `src/services/memory/memoryTools.ts`.
- Provider cache-marker contract test suite proving the cacheable system-prompt prefix
  is byte-stable across dynamic-layer changes and that the cache signature only
  rotates when the cacheable layers themselves change
- `computeTemporalMarkers()` helper for deriving day-separator, "later that day",
  soft inline timestamp, and cold-start-cue markers between adjacent messages
- Side-thread sandbox for conversations: `Conversation` now supports optional
  `parentConversationId` and `isSideThread` flags, and `useChatStore` exposes
  `createSideThread` / `discardSideThread` for branching off a parent
  conversation to explore a tangent without polluting the main timeline
- Single-thread collapse + sidebar IA (phase 161 §4.1 / §5): `Conversation`
  gains optional `isCanonical` and `archivedFromMigration` flags. The new
  `getOrCreateCanonicalThread` store action routes "new chat" affordances
  back to one canonical thread per (persona|default) group, and a v6→v7
  persist migration archives older conversations behind a collapsible
  Archived section in the sidebar (no data is destroyed). The chat header
  now exposes a side-thread toggle (start a side thread on the main thread,
  discard it from a side thread) using the new
  `chat.startSideThread` / `chat.discardSideThread` keys (with localized
  copy in all shipped locales). Sidebar exposes the new section through
  `nav.archivedSectionLabel` and the `sidebar-archived-*` testIDs.
- Memory screen Facts and Blocks tabs that surface the structured fact store —
  filter facts by subject, toggle pinned-only, pin/unpin/forget individual
  facts, and edit named memory blocks inline
- Temporal markers now render inline in the chat transcript: day separators,
  "later that day" cues, soft inline timestamps, and cold-start cues appear
  between bubbles based on adjacent message timestamps
- Persona switches inside a single thread are now recorded as inline
  non-bubble events (phase 161 §4.1 — Gap G). `Conversation` gains an
  optional `personaEvents[]` log; `updatePersonaInConversation` appends an
  entry whenever the persona actually changes on a non-empty thread, and
  the chat transcript renders a derived `<persona-switch from → to>` row
  before the next message via the new `computePersonaSwitchMarkers()` pure
  helper. New i18n keys `chat.personaSwitchEvent` and
  `chat.personaSwitchEventInitial` are localized in all shipped locales.
- All shipped locales (ar, de, es, fr, ja, pt-BR, zh-CN, zh-TW) updated with
  the full memory translation keyset (Facts/Blocks tab labels, sync status,
  external-update notice)
- Query-time fact recall (plan §4.5 step 2): `recallFactsForQuery()` ranks
  the bi-temporal fact store with a hybrid score (cosine similarity + lexical
  overlap + pinned boost), gracefully degrades to text-only when no embedder
  is configured or the embedder fails, and honours `asOf` for historical
  queries. `embedFact()` and `backfillFactEmbeddings()` lazily populate fact
  embeddings; `setFactEmbedding()` persists vectors to the existing
  `memory_facts.embedding` column. The output slots straight into
  `assemblePrompt({ retrievedFacts })` for Layer-3 `<retrieved_memory>`
  injection
- 4-layer budget allocator (plan §6.5): new `layeredBudget.ts` with
  `computeLayeredBudget()` (L1 tools 15% / 12K cap, L2 system 65%, L3 focus
  5% / 1.8K cap, L4 user-turn 15% / 8K cap), `selectFactsWithinBudget()`
  (drops trailing non-pinned facts to fit a token cap; pinned facts are
  mandatory), and `applyMemoryCascade()` returning ordered recommendations
  under pressure: `drop_retrieved_facts` → `window_buffer_tail` →
  `compress_l2_blocks` → `tier2_compaction` → `tier3_compaction`
- Memory-aware compaction (plan §6.4): `buildStructuredSummary()` now
  optionally folds the active focus block and open-thread labels into the
  emitted summary so multi-round compaction stays anchored to long-term
  state. `DefaultContextEngine.compact()` accepts `idleSinceLastTurnMs`,
  `focusBlock`, and `openThreads`; non-forced summarization is skipped when
  the conversation is mid-burst (`idle < 90s`) unless the budget is
  genuinely exceeded (`COMPACTION_IDLE_GUARD_MS = 90_000`)
- Public repository baseline files: README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, LICENSE, and CHANGELOG
- GitHub issue templates, pull request template, and baseline CI workflow
- `npm run verify` as the default local verification command
- `THIRD_PARTY_PROVENANCE.md` for source and patch attribution tracking
- `ARCHITECTURE.md` plus contributor docs for development setup, testing, privacy, and feature support
- `.nvmrc` and CI pinning to the documented Node baseline

### Changed

- Bumped chat-store persisted version 5 → 6 (additive — adds optional
  side-thread fields to existing conversations, no data transform required)
- Sidebar now hides ephemeral side-thread conversations from the main list
  (they remain accessible from the parent conversation’s context)
- Renamed the `direct` conversation mode to `chitchat`. Legacy values are accepted on every input boundary and silently upgraded.
- Expanded `.gitignore` coverage for private work products, native outputs, caches, and coverage artifacts
- Sanitized shipped locale placeholders to remove maintainer-specific usernames and local paths
- Removed source-provenance wording from contributor-facing source comments
- Replaced the hardcoded Android release build environment with an environment-driven wrapper and preflight check
