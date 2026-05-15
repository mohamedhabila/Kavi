# Kavi Living Memory Implementation

Status: production hardening validation green as of 2026-05-14.

Follow-up design: [memory-sota-architecture-plan.md](memory-sota-architecture-plan.md) documents the 2026 research review, current under-utilization findings, and implementation-ready plan for the next memory iteration.

This document records the implemented fixes from the living-memory audit and the validation gates used before commit. The deeper research notes and local experiment artifacts remain in `_research/`, which is intentionally ignored by the public repository.

## Implemented Fixes

- [x] Live post-turn accumulation: completed assistant turns now call the memory lifecycle path, mark the conversation dirty, skip incomplete/cancelled turns, and respect the long-term-memory opt-out.
- [x] Scoped fact provenance: durable facts now carry scope, origin conversation/thread/task, source turn/message, source summary, importance, access counters, reinforcement timestamps, decay policy, and expiry metadata.
- [x] Episodic memory and evidence: compact episode summaries and fact evidence rows are persisted in SQLite and episode summaries are indexed into the persistent memory chunk table.
- [x] Consolidator V2: consolidation accepts message windows and parses scoped facts, invalidations, episode summaries, open threads, evidence ids, confidence, and importance.
- [x] Scoped working memory: active focus and open threads now live in SQLite-backed scoped working blocks keyed by conversation/thread/task, with legacy global blocks retained only as a migration fallback.
- [x] Working-memory fallback: when no consolidation provider is configured, Kavi updates scoped active focus/open threads heuristically without inventing durable facts.
- [x] Human-like recall scoring: recall now uses scope boosts, temporal decay, confidence, importance, reinforcement, pinned eligibility, access counters, historical `asOf` scoring, and a diversity pass.
- [x] Strict recall isolation: conversation-scoped facts are recalled only for their originating conversation, session-scoped facts are recalled only for their originating task, and pinned facts no longer bypass scope eligibility.
- [x] Canonical memory policy gate: prompt reads, writes, and optional network-assisted providers share one long-term-memory policy check.
- [x] Legacy prompt cleanup: orchestrator and pilot review prompts no longer inject file-backed global/conversation memory, so opt-out and scoped recall behavior are enforced by the canonical living-memory bridge.
- [x] Persistent hybrid memory search: agent memory search uses the SQLite chunk index as the active backend, records chunk metadata such as scope/source/version/deletion state, filters conversation chunks by conversation id, and returns a degraded SQLite result instead of falling back to legacy unscoped file search.
- [x] Tool and UI metadata: memory tools accept and return scope/provenance fields, and the Memory facts screen surfaces scope, confidence, importance, source, and recall metadata.
- [x] Sidebar continuity: the Memory sidebar reads recent scoped working blocks before consulting migration fallback blocks.
- [x] Product naming cleanup: touched tests and fixtures use Kavi naming instead of legacy OpenClaw labels.

## Validation

Focused memory suite:

```bash
npm test -- --runInBand __tests__/services/consolidator.test.ts __tests__/services/memory/consolidatorScheduler.test.ts __tests__/services/memory/factRecall.test.ts __tests__/services/memory/lifecycle.test.ts __tests__/services/memory/schema.test.ts __tests__/engine/parity-memory-tools-wiring.test.ts __tests__/engine/memory-tools-opt-out.test.ts __tests__/integration/memory-scenarios.test.ts
```

Result: superseded by the full production gate below.

Production gates:

```bash
npm run verify
npm run check:android:release-env
npm run build:android:release
```

Results:

- `npm run verify`: passed. Full Jest result: 4649 tests passed, 3 skipped, 4652 total.
- `npm run check:android:release-env`: passed.
- `npm run build:android:release`: run after commit; the APK is exported to `release-artifacts/android/kavi-release.apk` and is intentionally ignored by Git.