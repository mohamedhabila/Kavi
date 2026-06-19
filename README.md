# Kavi

[![CI](https://github.com/mohamedhabila/Kavi/actions/workflows/ci.yml/badge.svg)](https://github.com/mohamedhabila/Kavi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 22](https://img.shields.io/badge/node-22.x-339933.svg)](.nvmrc)

Kavi is a mobile-first AI assistant for iOS and Android.

It started as a side project. Then the side project learned tools, memory,
MCP, SSH, browser automation, local models, Expo release chores, and native
phone actions. At some point it stopped being a demo and became a full
assistant in a pocket. This repository is the cleaned-up public version: useful
to run, practical to inspect, and friendly to contributors who like software
that can do real work without hiding the wiring.

## What Kavi Does

- Runs direct chat or agentic workflows from a mobile UI.
- Uses hosted model providers and on-device Gemma through native runtime hooks.
- Connects to MCP servers and keeps ClawHub-compatible skills as a first-class
  source of assistant capabilities.
- Works with conversation workspaces, browser sessions, SSH targets, GitHub
  workflows, Expo/EAS projects, files, media, and voice input.
- Maintains optional local long-term memory in SQLite, with user controls to
  disable it.
- Treats mobile-native tools as real surfaces: contacts, calendar, clipboard,
  sharing, notifications, location, media, and device state are modeled through
  explicit permissions and test fixtures.

Kavi is not trying to be a tiny chat wrapper in a trench coat. It is closer to
a developer workstation that got compressed until it fit on a phone.

## Why Developers Might Care

- **Mobile-first agent runtime:** the app is designed around phone ergonomics,
  not a desktop product squeezed into a smaller screen.
- **Tooling with contracts:** builtin tools carry capability metadata and are
  checked by `npm run check:tool-contracts`.
- **Public hygiene by default:** repository checks fail on private artifacts,
  stale internal language, generated release output, oversized contribution
  files, and barrel-only modules.
- **Benchmark-shaped evals:** local and opt-in harnesses use structural outcome
  rubrics such as file hashes, native fixture state, memory predicates, graph
  terminal status, token budgets, and cache reads.
- **No mystery build step:** Expo, React Native, native iOS/Android code,
  patches, generated editor assets, and verification scripts are all in the
  repo.

## Readiness Snapshot

These numbers describe the current public release gate. They are not leaderboard
claims; they are reproducible checks for this mobile assistant codebase.

| Signal                    | Current gate                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Contributor CI            | `npm run verify` runs public hygiene, language, links, licenses, app metadata, i18n, maintainability, lint, typecheck, and deterministic Jest. |
| Local deterministic tests | Latest release check passed 6,100+ Jest tests across 700+ suites.                                                                              |
| Coverage floor            | `npm run test:coverage` enforces statements >=83.8%, branches >=70.7%, functions >=87.6%, lines >=84.3%.                                       |
| Strict keyless metrics    | `npm run eval:memory` passed 3/3 memory metric tests; `npm run eval:agent` passed 13/13 agent metric tests.                                    |
| Opt-in E2E shape          | 55 selected-provider scenarios plus 2 delegation scenarios, mapped across 24 benchmark families and 11 assessment dimensions.                  |
| E2E pass bar              | `npm run verify:strict:e2e` requires the configured selected-provider scenario pass bar; see [docs/testing.md](docs/testing.md).               |

## Prerequisites

- Node.js 22 LTS recommended
- npm 10 or newer
- Java 17 for Android release checks and builds
- Android Studio and Android SDK for Android device or emulator work
- Current Xcode and CocoaPods for iOS development on macOS

## Quickstart

Install dependencies:

```bash
nvm use
npm install
```

Start Expo development tooling:

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

Run the local verification baseline. This is the same contributor gate used by
pull request CI:

```bash
npm run verify
```

Run deterministic coverage before release candidates or broad behavior changes:

```bash
npm run test:coverage
```

Notes:

- `npm install` runs `patch-package` and rebuilds local editor assets.
- After changing native iOS dependencies, run `cd ios && pod install`.
- Optional local environment overrides can be copied from `.env.local.example`
  to `.env.local`.
- Maintainer signing material, generated release output, coverage reports, and
  private working notes are intentionally excluded from the public repository.

## Core Commands

```bash
npm start
npm run android
npm run ios
npm run check:android:release-env
npm run build:android:release
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
npm run test:watch
npm run test:coverage
npm test -- --runInBand
npm run verify
npm run verify:strict
npm run verify:strict:e2e
```

## Architecture Tour

Kavi is organized around a few major subsystems:

- `src/screens`: user-facing mobile screens
- `src/engine`: orchestration loop, tool management, and runtime policies
- `src/services`: providers, storage, integrations, local runtime, MCP, Expo/EAS,
  SSH, media, memory, and workflow services
- `src/store`: persisted app state and hydration logic
- `__tests__`: unit, integration, screen, Android contract, and acceptance tests
- `plugins`: bundled plugin surfaces kept compatible with the mobile app

The app is mobile-first by design. Some features rely on remote services or
external credentials, while others run locally on-device. MCP and Expo/EAS
integrations are public runtime surfaces and should remain compatible when
changing repository hygiene rules.

## Testing

Most tests are local and deterministic. A small number of live-provider tests
are opt-in and gated by environment variables so contributors do not
accidentally hit paid or remote services.

Default contributor gate:

```bash
npm run verify
```

Strict keyless maintainer gate:

```bash
npm run verify:strict
```

Selected-provider E2E, opt-in and credentialed:

```bash
npm run verify:strict:e2e
```

See [docs/testing.md](docs/testing.md) for gate tiers, E2E setup, benchmark
families, pass bars, and live-provider scripts.

## Privacy And Memory

Kavi keeps optional long-term memory on-device in SQLite: facts, entities,
scoped focus blocks, episodes, and recall indexes. Optional consolidation or
embedding providers can send selected snippets to the user-configured provider
when those features are enabled.

You can fully disable long-term memory in Settings. When disabled:

- Living-memory bridge skips block reads and recall.
- The consolidator scheduler stops before any extractor call.
- Migration backfills for archived threads are no-ops.
- Legacy file-backed memory is not injected into prompts.
- Every `memory_*` engine tool returns
  `{ ok: false, code: 'permission_denied' }` so the agent can respond
  gracefully.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/setup/development.md](docs/setup/development.md)
- [docs/testing.md](docs/testing.md)
- [docs/feature-matrix.md](docs/feature-matrix.md)
- [docs/privacy-policy.md](docs/privacy-policy.md)
- [docs/privacy-and-permissions.md](docs/privacy-and-permissions.md)
- [docs/release.md](docs/release.md)
- [THIRD_PARTY_PROVENANCE.md](THIRD_PARTY_PROVENANCE.md)

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before starting work. It covers
setup expectations, generated assets, patches, testing, public hygiene, and pull
request standards.

Good first contribution areas are usually docs, focused tests, small UI polish,
fixture improvements, and narrow tool-contract fixes. Large orchestration,
memory, native runtime, or provider changes should start with a clear issue or
design note so review stays boring in the best possible way.

## Security

Please read [SECURITY.md](SECURITY.md) before reporting vulnerabilities. Do not
open public issues for security-sensitive problems.

## Code Of Conduct

This project follows the standards in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Kavi is released under the [MIT License](LICENSE).
