# Contributing To Kavi

Thanks for contributing to Kavi.

This repository is an application codebase, not a library package. The goal for contributions is to keep the app stable for real-world use while continuing to improve architecture, test coverage, and contributor ergonomics.

## Before You Start

- Read [README.md](README.md) for the project overview and core commands.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the subsystem map.
- Read [docs/setup/development.md](docs/setup/development.md) and [docs/testing.md](docs/testing.md) before changing build or test workflows.
- Read [docs/privacy-and-permissions.md](docs/privacy-and-permissions.md) before changing tools, permissions, agent execution surfaces, or remote integrations.
- Read [SECURITY.md](SECURITY.md) before reporting vulnerabilities.
- Keep changes focused. Small, reviewable pull requests are strongly preferred.

## Development Environment

Recommended baseline:

- Node.js 22 LTS
- npm 10 or newer
- Java 17 for Android release builds
- Android Studio and Android SDK for Android work
- Current Xcode and CocoaPods for iOS work on macOS

Install dependencies:

```bash
nvm use
npm install
```

Start the local development server:

```bash
npm start
```

Run on Android:

```bash
npm run android
```

Run on iOS:

```bash
npm run ios
```

Run the Android release environment check:

```bash
npm run check:android:release-env
```

## Verification

Run the default local verification path before opening a pull request:

```bash
npm run verify
```

Pull request CI installs dependencies with `npm ci` and runs this same command
from `.github/workflows/ci.yml`. The gate currently runs, in order:

- `npm run check:public-hygiene`
- `npm run check:public-language`
- `npm run check:links`
- `npm run check:licenses`
- `npm run check:app-metadata`
- `npm run check:i18n`
- `npm run check:no-legacy-planning-imports`
- `npm run check:thin-e2e-harness`
- `npm run check:graph-owned-mutations`
- `npm run check:dead-exports`
- `npm run check:tool-contracts`
- `npm run check:maintainability`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --runInBand`

If you are working on a narrow area, run the targeted tests for that area too.
For high-risk agent, graph, memory, orchestration, or E2E harness changes,
include `npm run verify:strict` in the pull request verification notes when it
is practical to run locally.

Useful supporting commands:

```bash
npm run check:public-hygiene
npm run check:public-language
npm run check:links
npm run check:licenses
npm run check:app-metadata
npm run check:i18n
npm run check:no-legacy-planning-imports
npm run check:thin-e2e-harness
npm run check:graph-owned-mutations
npm run check:dead-exports
npm run check:tool-contracts
npm run check:maintainability
npm run lint
npm run typecheck
npm run test:coverage
npm test -- --runInBand
npm run test:watch
npm run format
```

### Graph-owned control plane

Agent run control graph state must mutate only through the graph layer (`src/engine/graph/**`) via `AgentControlGraphEvent` reducers. Store code may persist normalized snapshots received from graph callbacks, but must not invent graph transitions inline. `npm run check:graph-owned-mutations` enforces this boundary.

## Generated Assets And Native Artifacts

Kavi includes generated editor assets and native build outputs.

- `npm install` automatically runs `patch-package` and rebuilds editor assets.
- If you change the editor runtime or templates, run `npm run build:editor-assets`
  and commit only the generated runtime files that belong in source control.
- Do not commit local cache directories, coverage output, emulator artifacts, or native build output.
- After changing iOS native dependencies, run `cd ios && pod install`.
- Use `npm run check:android:release-env` before debugging Android release-build failures.

## Dependency Patches

This repository uses `patch-package`.

- If you change a dependency patch, keep the patch minimal and document why the patch exists in the pull request.
- Do not regenerate a patch from a dirty dependency tree that includes unrelated build output.
- Update [THIRD_PARTY_PROVENANCE.md](THIRD_PARTY_PROVENANCE.md) when a patch changes upstream attribution or release obligations.

## Coding Standards

- Preserve existing style unless the change intentionally introduces a clearly better local pattern.
- Run `npm run lint` before opening a pull request.
- Use `npm run format` for mechanical formatting changes and keep them separate from behavior changes when practical.
- Keep public behavior explicit in code and tests.
- Prefer small refactors over broad rewrites.
- Keep hand-maintained contribution-facing files within the repository file-size
  limit and avoid pass-through barrel files.
- Add or update tests when behavior changes.
- Avoid mixing unrelated cleanup into a feature or bug-fix pull request.

## Pull Requests

A good pull request for Kavi should:

1. Explain the problem clearly.
2. Describe the user-visible or developer-visible change.
3. Include verification steps.
4. Call out any follow-up work that remains.

Before submitting:

- Rebase or merge cleanly onto the current default branch.
- Run `npm run verify`.
- Add `npm run verify:strict` when the change affects agent, graph, memory,
  orchestration, or E2E harness behavior and the strict gate is practical to run
  locally.
- If you cannot run the full gate while preparing a docs-only change, run
  `npm run check:public-hygiene` before requesting review.
- Make sure new files and docs use the public `Kavi` name consistently.
- Do not include local credentials, personal notes, or build artifacts.
- Keep scratch work and planning notes out of git history.

## Issues

- Use the bug report template for defects.
- Use the feature request template for product or architecture proposals.
- For security reports, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Good First Contributions

The most contribution-friendly work usually falls into these buckets:

- focused bug fixes with regression tests
- documentation improvements
- UI polish that stays within existing patterns
- targeted modularization of very large files
- test cleanup that reduces warning noise without changing product behavior

## Communication

Be direct, technical, and specific. If a design tradeoff is unclear, explain the tradeoff and the proposed direction in the issue or pull request.
