# Third-Party Provenance

This file records code and generated assets in Kavi that have explicit upstream lineage or special attribution requirements.

It intentionally moves provenance details out of inline implementation comments and into one public inventory that can be reviewed during release preparation.

## Scope

This file focuses on:

- local source files with known historical carry-forward lineage
- generated assets built from third-party editor packages
- dependency patches that modify upstream code shipped in the app

It does not replace the normal license obligations for packages installed through `package.json`.

## Status Legend

- `Verified`: upstream package or repository and license were confirmed from installed package metadata or the patch target.
- `Maintainer-attested first-party lineage`: the code predates the public repository but remains within the same Kavi / OpenClaw project lineage. During the 2026-04-18 open-source preparation pass, these modules were reviewed as maintainer-owned first-party code and are published under this repository's MIT license.

## Inventory

| Surface                                                                                                                                                | Upstream / Source                                                                                            | Status                                  | License | Notes                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `patches/@dylankenneally+react-native-ssh-sftp+1.6.8.patch`                                                                                            | `@dylankenneally/react-native-ssh-sftp`                                                                      | Verified                                | MIT     | Local patch adds host fingerprint capture, verified host-key flows, and JavaScript bridge support needed for secure SSH target handling on Android and iOS.                                                              |
| `assets/editor/editor.html`, `android/app/src/main/assets/editor/editor.html`, `assets/editor/runtime/*`, `scripts/build-editor-assets.js`             | CodeMirror packages (`codemirror`, `@codemirror/*`)                                                          | Verified                                | MIT     | Editor HTML is generated locally from installed CodeMirror packages during `npm install` and `npm run build:editor-assets`. The generated bundle is committed so native builds do not depend on a runtime bundling step. |
| `src/services/cron/parse.ts`, `src/utils/string-normalization.ts`                                                                                      | Earlier private Kavi / OpenClaw utility history                                                              | Maintainer-attested first-party lineage | MIT     | These compact helpers were reviewed as first-party project code carried forward from earlier private iterations of the same product lineage.                                                                             |
| `src/services/links/detect.ts`, `src/services/terminal/ansi.ts`, `src/services/terminal/safeText.ts`                                                   | Earlier private Kavi / OpenClaw utility history                                                              | Maintainer-attested first-party lineage | MIT     | The public cleanup removed inline lineage notes; this inventory retains the trace while confirming the modules remain first-party code.                                                                                  |
| `src/services/browser/automation.ts`, `src/services/browser/types.ts`, `src/services/browser/traceStore.ts`, `src/engine/tools/browser-definitions.ts` | Earlier private Kavi / OpenClaw browser automation surface                                                   | Maintainer-attested first-party lineage | MIT     | The browser automation layer predates the public repo, but the carried-forward implementation stays within the same project ownership and license.                                                                       |
| `src/services/media/service.ts`, `src/engine/toolResultGuard.ts`, `src/engine/toolResultPairingGuard.ts`, `src/engine/loopDetection.ts`                | Earlier private Kavi / OpenClaw runtime and orchestration history                                            | Maintainer-attested first-party lineage | MIT     | These runtime guardrails were reviewed as internal project code retained across private iterations rather than third-party imports.                                                                                      |
| `src/i18n/locales/*.ts`                                                                                                                                | Earlier private Kavi localization baseline                                                                   | Maintainer-attested first-party lineage | MIT     | The localization baseline originated before the public repo but remains a first-party project asset after the placeholder and provenance cleanup pass.                                                                   |
| `src/services/llm/LlmService.ts`                                                                                                                       | Pre-public transport lineage noted in audit, including an earlier ChatKnot/OpenAI-service ancestry reference | Maintainer-attested first-party lineage | MIT     | The file is heavily evolved. The earlier transport patterns were reviewed as same-project lineage, so no additional third-party attribution is required beyond this record.                                              |

## Patch-Package Notes

The SSH patch is intentionally retained in-repo because Kavi depends on verified host-key flows that are not provided by the upstream package version currently in use.

If this patch is ever upstreamed or replaced, update this file and `CONTRIBUTING.md` at the same time.

## Maintenance Checklist For This File

1. Add a new entry before merging any future dependency patch or historical carry-forward module that changes attribution or license obligations.
2. If an entry comes from outside the Kavi / OpenClaw first-party lineage, record the upstream repository and license before it lands on the default branch.
3. Re-check the dependency patch against the exact version in `package-lock.json` after every dependency upgrade.

## Concept Attribution

The living-memory subsystem (`src/services/memory/factStore.ts`, `consolidator.ts`, `focus.ts`, `promptAssembly.ts`, `memoryTools.ts`, `evidenceBridge.ts`) was designed with reference to publicly published architectural patterns from the agent-memory research community. **No source code was copied from these projects** — only the architectural concepts informed our independent implementation. The relevant influences are:

- **Letta / MemGPT** (Apache-2.0) — concept of explicit memory blocks with editable / read-only segments and a recall-vs-archival split between a small in-context working set and a larger searchable corpus.
- **mem0** (Apache-2.0) — concept of structured fact extraction into typed atomic units, with deduplication / supersession at write time rather than retrieval time.
- **Graphiti / Zep** (Apache-2.0) — concept of deriving a small "focus" header from the broader memory store on each turn, refreshed deterministically rather than via every-turn LLM summarization.

Our Kavi implementation is an independent design that combines these patterns with our own three-tier (core / recall / episodic) layout, our own consolidation policy, and our own provider-cache marker discipline.
