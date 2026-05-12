# Kavi Living Memory Implementation

Status: production validation green as of 2026-05-13.

This document records the implemented fixes from the living-memory audit and the validation gates used before commit. The deeper research notes and local experiment artifacts remain in `_research/`, which is intentionally ignored by the public repository.

## Implemented Fixes

- [x] Live post-turn accumulation: completed assistant turns now call the memory lifecycle path, mark the conversation dirty, skip incomplete/cancelled turns, and respect the long-term-memory opt-out.
- [x] Scoped fact provenance: durable facts now carry scope, origin conversation/thread/task, source turn/message, source summary, importance, access counters, reinforcement timestamps, decay policy, and expiry metadata.
- [x] Episodic memory and evidence: compact episode summaries and fact evidence rows are persisted in SQLite and episode summaries are indexed into the persistent memory chunk table.
- [x] Consolidator V2: consolidation accepts message windows and parses scoped facts, invalidations, episode summaries, open threads, evidence ids, confidence, and importance.
- [x] Working-memory fallback: when no consolidation provider is configured, Kavi updates active focus/open threads heuristically without inventing durable facts.
- [x] Human-like recall scoring: recall now uses scope boosts, temporal decay, confidence, importance, reinforcement, pinned eligibility, access counters, historical `asOf` scoring, and a diversity pass.
- [x] Persistent hybrid memory search: agent memory search now prefers the SQLite hybrid index when embeddings are configured and falls back to text search safely.
- [x] Tool and UI metadata: memory tools accept and return scope/provenance fields, and the Memory facts screen surfaces scope, confidence, importance, source, and recall metadata.
- [x] Product naming cleanup: touched tests and fixtures use Kavi naming instead of legacy OpenClaw labels.

## Validation

Focused memory suite:

```bash
npm test -- --runInBand __tests__/services/consolidator.test.ts __tests__/services/memory/consolidatorScheduler.test.ts __tests__/services/memory/factRecall.test.ts __tests__/services/memory/lifecycle.test.ts __tests__/services/memory/schema.test.ts __tests__/engine/parity-memory-tools-wiring.test.ts __tests__/engine/memory-tools-opt-out.test.ts __tests__/integration/memory-scenarios.test.ts
```

Result: 8 suites passed, 92 tests passed, 0 failed.

Production gates:

```bash
npm run verify
npm run check:android:release-env
npm run build:android:release
```

Results:

- `npm run verify`: passed. Full Jest result: 273 suites passed, 2 skipped; 4644 tests passed, 3 skipped.
- `npm run check:android:release-env`: passed.
- `npm run build:android:release`: passed. Artifact exported to `release-artifacts/android/kavi-release.apk` at 74118394 bytes.