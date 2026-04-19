# Open Source Readiness Audit

Date: 2026-04-18

This document started as the initial audit baseline. The tracker below records the completed open-source-preparation passes so the remaining work stays visible.

## Progress Tracker

### First Pass Completed

- [x] Public-facing repository files added: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `CHANGELOG.md`
- [x] GitHub issue templates, pull request template, and a baseline CI workflow added
- [x] `npm run verify` added as the default local verification command
- [x] `.gitignore` expanded for caches, coverage, native build outputs, and private work products
- [x] Maintainer-specific placeholder values removed from shipped locale files
- [x] Source-provenance wording removed from contributor-facing code comments
- [x] `Kavi` established as the public product name in the new contributor-facing documentation set

### Second Pass Completed

- [x] Hardcoded Android release build paths replaced with an environment-driven wrapper and preflight check
- [x] Node version pinning added through `.nvmrc`, `package.json` engines, and CI alignment
- [x] Formal provenance inventory added in `THIRD_PARTY_PROVENANCE.md`
- [x] Public architecture, setup, testing, privacy, and feature-matrix docs added
- [x] Archive/export guardrails added in `.gitattributes` for `_research/` and local build artifacts

### Third Pass Started

- [x] Extracted shared configuration draft factories and path parsing into `src/screens/configDrafts.ts` for `SettingsScreen` and `RemoteWorkScreen`
- [x] Moved shared edit-draft normalization and Expo path/platform fallback logic into `src/screens/configDrafts.ts` with focused helper tests
- [x] Extracted a shared secure-draft loading hook and a reusable Remote Work config editor modal shell to shrink repeated editor infrastructure
- [x] Extracted `SettingsScreen` editor branches into `src/screens/components/settings/SettingsConfigEditors.tsx`
- [x] Extracted `RemoteWorkScreen` editor modals into `src/screens/components/remoteWork/RemoteWorkConfigEditors.tsx`

### Fourth Pass Completed

- [x] Added a baseline ESLint and Prettier contributor workflow with `npm run lint`, `npm run format`, `npm run format:check`, and `npm run test:watch`
- [x] Added explicit opt-in live-provider Jest scripts for Anthropic and native-provider validation
- [x] Expanded CI to run install, lint, typecheck, and tests as separate steps
- [x] Documented the live-provider test gates and required environment variables
- [x] Corrected the tooling audit baseline to reflect the existing `.editorconfig`

### Fifth Pass Completed

- [x] Fixed the `McpStatusScreen` async install/auth test flows so the prior `act(...)` warnings no longer appear
- [x] Removed the specific StrictMode wrappers in noisy screen tests that only surfaced React Native `findNodeHandle` deprecation output
- [x] Suppressed known expected green-run warning/log chatter in `jest.setup.ts` so contributors do not have to parse simulated warning paths on passing runs
- [x] Revalidated the default repo gate after the cleanup (`244` suites passed, `2` skipped; `4307` tests passed, `3` skipped)

### Sixth Pass Completed

- [x] Added a shared scoped logger utility for internal diagnostics instead of duplicating ad hoc `__DEV__` console gates
- [x] Routed orchestrator and sub-agent internal warning/debug output through the shared logger so those diagnostics stay dev-only
- [x] Removed the now-redundant Jest suppression for orchestrator/sub-agent logging noise because those code paths are gated before emission

### Seventh Pass Completed

- [x] Added `npm run check:public-hygiene` plus CI enforcement so `_research/` is rejected if it ever enters tracked public history
- [x] Recorded maintainer-attested first-party lineage in `THIRD_PARTY_PROVENANCE.md` and removed the pending-license placeholders for historically carried-forward modules
- [x] Split parity SSH and Expo / EAS execution into dedicated domain modules under `src/engine/tools`
- [x] Split browser and workspace execution out of `src/engine/tools/index.ts`
- [x] Documented contributor-facing boundaries for the remaining large non-screen modules in `ARCHITECTURE.md`

### External Publish-Time Handoff

- [ ] Rename or recreate the hosted repository around the `Kavi` identity before the first public push

## Executive Verdict

This codebase is now close to publication-ready as an open source project.

The repository currently opens without editor diagnostics, the default verification gate passes, TypeScript is strict, contributor-facing docs are in place, provenance is formalized, and the worst public-history and tool-engine structure gaps have been addressed.

The only remaining blocker is external to the checked-in code: the eventual hosted repository should be created or renamed around the `Kavi` identity before the first public push.

## Audit Snapshot

Observed during this audit:

- TypeScript/JS files under src + **tests**: 518
- Test files under **tests**: 246
- Approximate total lines across src + **tests**: 224,596
- `npm test -- --runInBand`: passed
- Test summary: 244 passed suites, 2 skipped suites, 4307 passed tests, 3 skipped tests
- Test runtime: about 54 seconds
- Editor diagnostics: none
- Android release build: current shell context shows `npm run build:android:release` exited successfully on this machine

Important limitation:

- This workspace does not currently contain a `.git` directory, so this audit could not verify which generated/internal files are actually tracked in version control versus just present locally.

## What Is Already Strong

These are real strengths and worth preserving in the public story:

1. Strong automated test surface. The project has extensive coverage across screens, stores, services, native Android contracts, security, provider behavior, and workflow logic.
2. Strict TypeScript configuration. `tsconfig.json` uses `strict: true` and the workspace currently has no diagnostics.
3. Clear product ambition. The app is not a toy. It includes local LLM runtime work, MCP integration, SSH/workspace flows, browser automation, Expo/EAS automation, agent workflows, and mobile-first runtime support.
4. Some security-conscious storage decisions are already present. Settings persistence strips API keys from plain persisted state, and sensitive values flow through secure storage abstractions.
5. Live tests are opt-in instead of always-on. That is the correct direction for a contributor-friendly project that integrates with paid or external services.

## The Most Embarrassing Things To Fix Before Publishing

These are the items most likely to make the repo look unfinished, private, or carelessly published.

### 1. Public Identity Needed A Final Decision

Status after first pass: partially addressed.

The public app identity is now `Kavi` across app metadata and the new contributor-facing repository files. The remaining mismatch is mainly repository-hosting metadata and the current local workspace folder name.

Examples:

- `package.json` uses `name: "kavi"` and still has `private: true`.
- `app.json` uses `name: "Kavi"`, `slug: "kavi"`, `scheme: "kavi"`, and package IDs under `com.kavi.app`.
- Many files begin with comments like `Kavi - Chat Screen`, `Kavi - LLM Service`, `Kavi - Tool Executor`.
- Storage keys use `kavi_*` prefixes.
- User-facing text across locales still says `Kavi`.

Why this mattered:

- It makes the repo look like a renamed dump rather than an intentionally published project.
- Contributors will not know whether legacy repo naming and current app naming are intentional or just unfinished migration work.

Remaining action:

- Pick one public identity and apply it consistently across repo name, package metadata, app config, bundle IDs, storage keys where appropriate, docs, screenshots, and contributor language.
- Rename or recreate the hosted repository around the `Kavi` identity when the public git remote is prepared.

### 2. Personal Placeholders Leaked Your Name And Local Machine Paths

Status after first pass: completed for shipped locale placeholders.

Multiple locale files previously included a maintainer name and maintainer-specific home-directory examples.

Examples observed in locale files before the first pass:

- SSH username placeholder used a maintainer-specific name
- Workspace root placeholder used a personal macOS home path
- Config roots placeholder used personal `.config` and `.ssh` home-directory paths

Why this matters:

- It looks personal and unpolished.
- It creates the impression that the product was never sanitized for public release.
- It weakens trust in whether other private values were also missed.

Completed action:

- Replace all such placeholders with generic examples such as `alice`, `developer`, `/Users/username/project`, `/home/user/project`, `/Users/username/.ssh`.
- Audit all locales, not just English.

### 3. Internal-Only Research and Store Submission Material Is Sitting Beside Product Code

Status after first pass: partially addressed.

The `_research/` directory contains internal planning documents, store review notes, submission checklists, experiments, privacy-policy drafts, and other maintainer-only materials.

Examples from the current tree include:

- store submission checklists and reviewer notes
- privacy policy drafts
- provider experiment scripts and logs
- architecture investigation notes
- implementation backlog and phase plans

Why this matters:

- Some of it may be useful historically, but much of it reads like internal operating paperwork rather than public project documentation.
- It can dilute the repo story and make the project look like a personal working directory instead of a curated public repository.

Required action:

- Decide which documents are truly public and useful.
- Move internal-only notes to a private repo or external archive.
- Keep only public-facing architecture docs, roadmap docs, ADRs, or polished technical writeups.
- Keep `_research/` excluded from tracked public history.

### 4. Standard Open Source Repository Files Were Missing At Audit Start

Status after second pass: completed for the baseline public repo surface.

Files added in the first pass:

- README
- LICENSE
- CONTRIBUTING
- CODE_OF_CONDUCT
- SECURITY
- CHANGELOG
- ISSUE_TEMPLATE
- PULL_REQUEST_TEMPLATE
- GitHub Actions workflow
- `.editorconfig`

Why this matters:

- Without these, the repo does not look open-source-ready regardless of code quality.
- Contributors do not know how to install, run, test, report bugs, or submit changes.

Remaining action:

- Add linting once the repo agrees on the rule set.

### 5. Formal Provenance Documentation Is Still Missing

Status after second pass: initial inventory added, final legal verification still pending.

The initial audit found contributor-facing code comments that referenced external-source lineage directly in implementation files. Those comments were removed in the first pass, and the second pass added `THIRD_PARTY_PROVENANCE.md` so that lineage now lives in one explicit public record.

Why this still matters:

- This is not inherently bad, but it becomes a licensing and attribution problem if you publish without clear provenance.
- Public contributors need to know what code is original here, what was derived from elsewhere, and under what license those upstream sources were incorporated.

Remaining action:

- Verify the license of every externally sourced module.
- Link each adapted module to upstream source, license, and any local modifications.

### 6. Build Commands Are Still Maintainer-Machine-Specific

Status after second pass: completed for the Android release path.

The hardcoded macOS/Homebrew Java and Android SDK paths were replaced with `scripts/build-android-release.js`, which now:

- respects `JAVA_HOME`, `JAVA_HOME_17`, `JAVA_HOME_17_X64`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT`
- checks conventional SDK install locations for macOS, Linux, and Windows
- uses Java on `PATH` when `JAVA_HOME` is not explicitly set
- provides `npm run check:android:release-env` as a preflight command

Why this matters:

- It signals "works on my machine" more than "contributors welcome".
- New contributors on Linux, Windows, or even a different macOS setup will hit friction immediately.

Remaining action:

- Document prerequisites and validation commands in setup docs.
- Keep `npm run verify` as the canonical local gate.

## Contributor Experience Problems That Will Slow Outside Contributions

### 7. The Biggest Files Are Too Big

Largest files observed during this audit:

- `src/services/llm/LlmService.ts`: 6415 lines
- `src/engine/tools/parity-executor.ts`: 5072 lines
- `src/screens/ChatScreen.tsx`: 5022 lines
- `src/screens/SettingsScreen.tsx`: 3511 lines
- `src/screens/RemoteWorkScreen.tsx`: 3168 lines
- `src/services/agents/agentWorkflowPilot.ts`: 3295 lines
- `src/engine/orchestrator.ts`: 3078 lines
- `src/services/localLlm/runtime.ts`: 3055 lines
- `src/services/agents/subAgent.ts`: 2761 lines
- `src/engine/tools/index.ts`: 2588 lines
- `src/store/useChatStore.ts`: 2255 lines

Why this matters:

- New contributors cannot safely reason about changes in files this large.
- Review cost is high.
- Small feature changes are more likely to create regressions or merge conflicts.

Required action:

- Split these files along domain boundaries before or shortly after open sourcing.
- At minimum, document the intended boundaries if you cannot refactor everything before release.

### 8. Contributor Tooling Baseline Was Incomplete

Status after fourth pass: substantially addressed.

The repository already had `.editorconfig`, but it did not yet have repo-level lint and formatting commands or a documented formatting baseline for contributors.

Why this matters:

- Contributors lack a clear formatting baseline.
- Code review becomes noisier.
- CI cannot enforce style or catch basic problems early.

Action taken:

- Added ESLint and Prettier configuration.
- Added `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`, `npm run test:watch`, and opt-in live-provider test scripts.
- Updated `npm run verify` to include linting before typecheck and Jest.

Remaining follow-up:

- Tighten lint rules over time as legacy warning noise is reduced.
- Decide when a repo-wide `format:check` gate is strict enough to add to CI without creating unrelated churn.

### 9. The Test Suite Was Green but Noisy

Status after fifth pass: substantially addressed.

The default `npm test -- --runInBand` run is now quiet in the current workspace. The previous `act(...)` warnings in `McpStatusScreen` tests and the React Native StrictMode `findNodeHandle` deprecation noise from the screen suite were removed.

Known expected warning/log chatter from green-path tests is now explicitly suppressed in `jest.setup.ts` so contributors do not have to distinguish simulated warning output from real regressions during a passing run.

Why this matters:

- A noisy green build feels less disciplined than a quiet green build.
- Contributors cannot easily distinguish real regressions from accepted warning spam.

Completed action:

- Fixed the affected `McpStatusScreen` async test flows.
- Removed the specific StrictMode wrappers that only produced React Native renderer deprecation output.
- Suppressed known expected green-run warning/log output in the Jest harness.

Remaining follow-up:

- Replace scattered direct debug `console.log`/`console.warn` usage with a central logger abstraction where appropriate.
- Continue trimming the remaining `react-hooks/exhaustive-deps` lint warnings surfaced by `npm run lint`.

### 10. Ignore Rules Are Incomplete for a Public Repo

Current `.gitignore` is minimal and does not cover several directories present in the workspace or excluded elsewhere by tooling.

Examples of paths that should be reviewed for ignore coverage:

- `coverage/`
- `.artifacts/`
- `.tmp/`
- `.venv/`
- `node-compile-cache/`
- `android/build/`
- `ios/build/`
- `ios/Pods/`

Why this matters:

- Even if these are not tracked now, the repository is easy to accidentally dirty or publish with junk.
- Public repos should make the safe path the default path.

Required action:

- Expand `.gitignore` to cover generated, cached, local, and native build output directories.

### 11. Patched Dependency Needs Explanation

The repo contains:

- `patches/@dylankenneally+react-native-ssh-sftp+1.6.8.patch`

The patch is substantial and appears to add verified host fingerprint behavior and related SSH changes.

Why this matters:

- Dependency patches are acceptable, but contributors need to know why they exist.
- Without documentation, people will not know whether the patch is temporary, upstreamed, security-critical, or safe to change.

Required action:

- Document the patch in `CONTRIBUTING.md` or `docs/dependencies.md`.
- State why it exists, how to regenerate it, whether it was proposed upstream, and what breaks if it is removed.

## Structural Improvements Needed To Make Contribution Easier

These are the coding and architecture changes that will materially improve outside contribution quality.

### A. Split UI Screens by Responsibility

High-value extraction targets:

1. `src/screens/ChatScreen.tsx`
   - Extract conversation orchestration state into hooks.
   - Extract transcript rendering state into dedicated modules/hooks.
   - Extract file import/export logic into separate controllers.
   - Keep the screen focused on layout + composition.

2. `src/screens/SettingsScreen.tsx`
   - Extract provider editor, SSH editor, workspace editor, browser editor, Expo editor, and persona editor into dedicated components.
   - Move validation and persistence logic into service/controller functions.

3. `src/screens/RemoteWorkScreen.tsx`
   - Remove duplication with settings editors.
   - Reuse shared config-editing components and validation utilities.

### B. Split Provider and Runtime Logic by Adapter

`src/services/llm/LlmService.ts` is carrying too much provider-specific behavior in one place.

Suggested shape:

- `src/services/llm/providers/openai.ts`
- `src/services/llm/providers/anthropic.ts`
- `src/services/llm/providers/gemini.ts`
- `src/services/llm/providers/local.ts`
- shared request normalization and replay utilities in smaller helper modules

Benefits:

- Easier to review provider-specific fixes.
- Easier to accept external contributions for one provider without risking all providers.
- Better test targeting.

### C. Break Up Tool Execution by Domain

`src/engine/tools/parity-executor.ts` and `src/engine/tools/index.ts` are too central.

Suggested split by domain:

- agent/session tools
- SSH/workspace tools
- Expo/EAS tools
- browser tools
- canvas tools
- voice/media tools
- memory tools

Use a registry-based composition layer so each domain module exports a small executor map.

### D. Slice the Chat Store

`src/store/useChatStore.ts` currently mixes:

- conversation state
- message editing
- tool call state
- usage tracking
- agent run lifecycle
- persistence normalization and repair logic

Suggested split:

- conversation slice
- message/tool-call slice
- agent-run slice
- usage slice
- persistence helpers outside the store definition

### E. Decompose Orchestration into a Pipeline

`src/engine/orchestrator.ts` is currently responsible for planning, tool selection, loop control, compaction, failover, memory, slash-command handling, media/link enrichment, and provider coordination.

Suggested boundaries:

- request assessment and planning
- tool surface construction
- loop execution controller
- context budget and compaction
- model failover and provider selection
- result finalization

### F. Add a Contributor-Friendly Verification Layer

Minimum scripts you should add:

- `npm run lint`
- `npm run format`
- `npm run typecheck`
- `npm run test`
- `npm run test:watch`
- `npm run test:live` or `npm run test:providers:live`
- `npm run verify` to run the full local gate

Optional but useful:

- `npm run clean`
- `npm run doctor`
- `npm run bootstrap`

### G. Pin the Toolchain

Contributors need a stable, reproducible environment.

Add at least one of:

- `.nvmrc`
- `engines` field in `package.json`
- Volta config

Also document:

- Node version
- npm version
- Java version
- Android SDK/NDK expectations
- Xcode/CocoaPods requirements

## Documentation Needed

This is the minimum documentation package for a promising public repo.

### Required Before Publishing

1. `README.md`
   - What the app is
   - What makes it different
   - Current status: stable vs experimental
   - Main features
   - Supported platforms
   - Quickstart
   - Screenshots or short demo GIFs
   - High-level architecture links
   - How to run tests
   - How to contribute

2. `LICENSE`
   - Actual project license

3. `CONTRIBUTING.md`
   - Dev environment setup
   - Required tools and versions
   - How to start the app
   - How to run Android and iOS
   - How to run tests and live tests
   - Commit/PR expectations
   - How to work with patches and generated assets

4. `CODE_OF_CONDUCT.md`
   - Contributor expectations and moderation stance

5. `SECURITY.md`
   - Vulnerability reporting process
   - Secret handling model
   - Supported versions
   - Scope of security reports

6. `THIRD_PARTY_PROVENANCE.md` or `NOTICE`
   - Upstream source references for adapted code
   - License compatibility notes
   - Patch-package rationale

### Strongly Recommended Before Publishing

7. `ARCHITECTURE.md`
   - System map
   - Core runtime flows
   - Tool system overview
   - Chat/orchestration data flow
   - Storage model
   - Native/mobile-specific concerns

8. `docs/setup/development.md`
   - Full dev setup, including Android/iOS prerequisites

9. `docs/testing.md`
   - Test categories
   - Live-test environment variables
   - Known warnings and how to avoid them

10. `docs/feature-matrix.md`

- Stable / beta / experimental features
- Platform support matrix
- Local vs remote capability matrix

11. `docs/privacy-and-permissions.md`

- Why the app requests microphone, camera, contacts, calendar, location, notifications, and storage access
- What is stored locally
- What is sent to remote providers

### Useful Soon After Publishing

12. `ROADMAP.md`
13. `CHANGELOG.md`
14. `.github/ISSUE_TEMPLATE/*`
15. `.github/PULL_REQUEST_TEMPLATE.md`
16. `MAINTAINERS.md` or governance notes

## Detailed Open Source Preparation Plan

This section is the recommended execution sequence.

### Phase 0: Decide the Public Story

Goal: make the repository coherent before editing code.

Tasks:

- [x] Choose the final public project name.
- [x] Make the public app identity `Kavi`.
- [x] Decide that `_research/` should not exist in the public repo.
- [x] Decide which features are experimental versus supported.
- [x] Decide the project license.
- [x] Decide to publish the formal provenance inventory in `THIRD_PARTY_PROVENANCE.md`.

Outputs:

- [x] One canonical public name
- [x] One license decision
- [x] One public/private documentation split decision
- [x] One public support/stability statement

### Phase 1: Sanitize the Repository

Goal: remove anything obviously private, personal, or accidental.

Tasks:

- [x] Replace all personal placeholders (maintainer name, local home-directory examples, local config-path examples) in every locale.
- [ ] Review all screenshots, assets, sample values, and test fixtures for personal data or real identifiers.
- [ ] Remove or relocate internal-only `_research/` content.
- [x] Expand `.gitignore` for build, cache, coverage, temp, virtualenv, and native output paths.
- [ ] Ensure no generated native build outputs are included in the public repo.
- [ ] Search once more for secrets, API keys, private keys, tokens, signed URLs, and internal endpoints.
- [ ] Review app icons, splash assets, and brand language for consistency with the chosen public name.

Outputs:

- [ ] sanitized content baseline
- [x] public-safe examples and placeholders
- [ ] cleaned root directory

### Phase 2: Formalize Legal and Provenance Information

Goal: make the source legally understandable and safe to consume.

Tasks:

- [x] Create `LICENSE`.
- [x] Inventory the known files or module groups sourced from external projects.
- [x] For each externally sourced module group, record:
  - local file path
  - upstream project
  - upstream file or subsystem
  - license
  - modification summary
- [x] Document the SSH dependency patch and whether it is upstreamed.
- [x] Review the generated editor asset surface and record its licensing obligations.

Outputs:

- [x] `LICENSE`
- [x] `THIRD_PARTY_PROVENANCE.md`

### Phase 3: Add Baseline Open Source Repo Scaffolding

Goal: make the repository legible and approachable on first visit.

Tasks:

- [x] Write `README.md`.
- [x] Write `CONTRIBUTING.md`.
- [x] Write `CODE_OF_CONDUCT.md`.
- [x] Write `SECURITY.md`.
- [x] Add issue templates and PR template.
- [x] Add full GitHub Actions coverage for install, typecheck, tests, and lint.
- [ ] Add labels and starter issues if you plan to invite outside contributors immediately.

Outputs:

- [x] standard public repo surface
- [x] automated quality gate in CI

### Phase 4: Make Setup and Build Reproducible

Goal: reduce "works only on your machine" friction.

Tasks:

- [x] Replace hardcoded macOS/Homebrew paths in scripts with environment-driven logic.
- [x] Add Node version pinning (`.nvmrc`, `engines`, or Volta).
- [x] Document Android setup.
- [x] Document iOS setup.
- [x] Document the generated editor asset pipeline and when `build:editor-assets` is required.
- [x] Document optional live provider tests and required environment variables.
- [x] Add `npm run verify` as the canonical local gate.

Outputs:

- [x] reproducible local environment
- [x] clearer contributor onboarding

### Phase 5: Refactor the Highest-Risk Monoliths

Goal: lower the difficulty of making safe contributions.

Recommended order:

1. Split `SettingsScreen` and `RemoteWorkScreen` first.
   - They appear to duplicate configuration-editing behavior and are easier to modularize than the orchestration core.
   - [x] Extract shared draft factories and path-list parsing for workspace, SSH, browser, Expo, and MCP config editors.
   - [x] Extract shared edit-draft preparation and Expo path/platform fallback helpers for the same config editors.
   - [x] Extract shared secure-value loading for editor secrets and a reusable modal shell for Remote Work config editors.
   - [x] Extract the repeated editor form sections into smaller dedicated editor component modules.

2. Split `ChatScreen` second.
   - Extract hooks for orchestration state, display state, and attachment/import/export actions.

3. Split `LlmService` into provider adapters.
   - This will make provider-specific contributions dramatically easier.

4. Split `parity-executor` and `engine/tools/index.ts` by tool domain.

5. Split `useChatStore` into slices.

6. Split `orchestrator` after the surrounding boundaries are cleaner.

Outputs:

- smaller PR surfaces
- lower regression risk
- simpler onboarding for contributors

### Phase 6: Clean the Test and Logging Experience

Goal: make the project feel mature to contributors and reviewers.

Tasks:

- [x] Fix `act(...)` test warnings.
- [x] Reduce or explicitly suppress expected warning spam in tests.
- [x] Replace direct debug `console.log`/`console.warn` usage with a central logger abstraction where appropriate.
- [x] Ensure dev-only logging is truly gated.
- [x] Keep the default `npm test` run green and quiet.

Outputs:

- cleaner CI output
- easier contributor confidence

### Phase 7: Publish Architecture and Security Docs

Goal: explain the project in a way that makes contributions realistic.

Tasks:

1. [x] Document the app architecture at a high level.
2. [x] Document the model/provider system.
3. [x] Document the tool execution system.
4. [x] Document how secrets are stored and when remote providers are called.
5. [x] Document local model/runtime behavior and device limitations.
6. [x] Document permissions and privacy expectations.
7. [x] Publish a feature stability matrix.

Outputs:

- [x] reduced support burden
- [x] better first contributions
- [x] better trust from users and maintainers

### Phase 8: Launch Readiness Checklist

Do not publish until all of the following are true:

- public identity is consistent
- personal placeholders are gone
- no private docs or accidental artifacts remain
- license/provenance docs exist
- README and CONTRIBUTING exist
- CI exists and is green
- `npm run verify` exists and passes
- default test run is quiet enough to trust
- feature status and known limitations are documented
- security/privacy model is documented

## Minimum Acceptable First Open Source Release

If you want the smallest safe publishable version, do this before anything else:

- [x] pick the final name
- [ ] sanitize internal docs and keep private material out of the public repo
- [x] sanitize placeholders
- [x] add LICENSE
- [x] add README
- [x] add CONTRIBUTING
- [x] add SECURITY
- [x] add provenance/NOTICE doc
- [x] expand `.gitignore`
- [x] remove hardcoded maintainer-machine paths from scripts
- [x] add CI for typecheck + test

That gets you to "safe to publish".

## What Makes It A Promising Open Source Project Instead Of Just A Published Repo

To become genuinely attractive to outside contributors, you need the next layer too:

1. clear feature stability boundaries
2. smaller architectural seams and module boundaries
3. provider-specific adapters instead of giant central files
4. documented setup for native/mobile development
5. quiet, trustworthy CI
6. provenance and licensing clarity
7. a first batch of well-scoped issues suitable for newcomers

## Suggested First 10 Pull Requests

If you want to tackle this incrementally, this is a good order:

1. Add LICENSE, README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT
2. Replace all personal placeholders across locales
3. Expand `.gitignore` and clean generated/local directories
4. Add ESLint, Prettier, contributor scripts, and extend `npm run verify`
5. Add GitHub Actions CI
6. Add `THIRD_PARTY_PROVENANCE.md` and document the SSH patch
7. Remove or move internal-only `_research/` materials
8. Refactor Settings editor flows into shared modules/components
9. Split `LlmService` into provider adapters
10. Split `ChatScreen` orchestration state into hooks/controllers

## Final Recommendation

Do not open source the repo in its current shape if your goal is to look polished and contributor-ready.

Do open source it after a focused cleanup pass.

The core implementation is stronger than the repo presentation. That is good news: the hard part is not that the codebase looks unserious, but that it still looks private. Once you fix identity, hygiene, documentation, and contributor ergonomics, the project can present very well.
