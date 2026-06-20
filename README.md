# Kavi

<img src="assets/icon.png" alt="Kavi app icon" width="96" height="96">

[![CI](https://github.com/mohamedhabila/Kavi/actions/workflows/ci.yml/badge.svg)](https://github.com/mohamedhabila/Kavi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 22](https://img.shields.io/badge/node-22.x-339933.svg)](.nvmrc)

Kavi is a mobile-only AI assistant for iOS and Android.

No required Kavi server. No gateway. No desktop sidecar quietly doing the
interesting work while the phone holds the clipboard. Kavi runs as the mobile
app: bring an on-device model or your own provider credentials, then let the
phone drive the assistant loop, tools, memory, files, voice, and native
actions.

It started as a side project with one tiny question and absolutely no respect
for scope: what if the phone was the assistant runtime, not just a remote
control? A few commits later, it had learned MCP, ClawHub-compatible skills,
SSH, browser automation, local models, Expo release chores, GitHub workflows,
workspaces, memory, voice, media, and native device actions. At that point, the
side project had stopped behaving like a side project and started looking
suspiciously like a full assistant in your pocket.

## What Kavi Does

- Runs direct chat and agentic workflows inside the mobile app.
- Works without a Kavi-hosted backend or gateway for core assistant use.
- Uses on-device Gemma through native runtime hooks, or user-configured hosted
  model providers when you choose them.
- Connects to optional MCP servers and keeps ClawHub-compatible skills as a
  first-class source of assistant capabilities.
- Works with conversation workspaces, browser sessions, SSH targets, GitHub
  workflows, Expo/EAS projects, files, media, and voice input when those
  integrations are configured.
- Maintains optional local long-term memory in SQLite, with user controls to
  disable it.
- Treats mobile-native tools as real surfaces: contacts, calendar, clipboard,
  sharing, notifications, location, media, and device state are modeled through
  explicit permissions and test fixtures.

Kavi is not a tiny chat box wearing a tool belt. It is the assistant runtime
squeezed into a phone: close to the camera, files, contacts, notifications,
network edges, and all the interruptions real mobile software has to survive.

## Why Developers Might Care

- **Mobile-only agent runtime:** the app is designed for phone constraints,
  permissions, interruptions, and native surfaces from the start.
- **No required backend:** core chat, local state, local memory, and on-device
  model paths do not depend on a Kavi server or gateway.
- **Tooling with contracts:** builtin tools carry capability metadata and are
  checked by `npm run check:tool-contracts`.
- **Repository hygiene by default:** checks fail on local artifacts, generated
  release output, oversized contribution files, and barrel-only modules.
- **Benchmark-shaped evals:** local and opt-in harnesses use structural outcome
  rubrics such as file hashes, native fixture state, memory predicates, graph
  terminal status, token budgets, and cache reads.
- **No mystery build step:** Expo, React Native, native iOS/Android code,
  patches, generated editor assets, and verification scripts are all in the
  repo.

## Quality Snapshot

These numbers describe the current quality gate. They are not leaderboard
claims; they are reproducible checks for this mobile assistant codebase.

| Signal                    | Current gate                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Contributor CI            | `npm run verify` runs public hygiene, language, links, licenses, app metadata, i18n, maintainability, lint, typecheck, and deterministic Jest. |
| Local deterministic tests | Latest verification passed 6,100+ Jest tests across 700+ suites.                                                                               |
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
- Signing material, generated release output, coverage reports, and local
  scratch notes stay out of source control.

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

Kavi's center of gravity is the phone. Some optional integrations call remote
services or require external credentials, while the app runtime, local state,
local memory, and on-device model path remain mobile-owned. MCP, ClawHub skills,
and Expo/EAS integrations are supported runtime surfaces and should remain
compatible when changing repository hygiene rules.

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
