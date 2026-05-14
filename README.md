# Kavi

Kavi is a mobile-first AI assistant for iOS and Android. It combines frontier model providers, on-device Gemma support, structured tool use, and mobile-native execution surfaces such as MCP, SSH, browser automation, workspaces, Expo/EAS automation, and voice workflows.

## Highlights

- Agentic and direct chat modes tuned for mobile workflows.
- On-device Gemma support with native runtime integration.
- Remote execution surfaces including SSH targets, browser providers, and workspace targets.
- MCP server discovery and connection management.
- Voice input, voice notes, attachments, and conversation workspaces.
- Expo/EAS project automation for mobile release workflows.
- Large automated test suite with TypeScript strict mode enabled.

## Project Status

Kavi is actively developed and already feature-rich, but parts of the codebase are still being hardened for broader public contribution. The default verification path is stable and the repository is being prepared for long-term open source maintenance.

## Prerequisites

- Node.js 22 LTS recommended
- npm 10 or newer
- Java 17 for Android release builds
- Android Studio and Android SDK for Android device/emulator work
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

Run the local verification baseline:

```bash
npm run verify
```

Check public-repo hygiene before publishing or preparing a release-focused branch:

```bash
npm run check:public-hygiene
```

Check that shipped locale files match the English i18n key tree and placeholders:

```bash
npm run check:i18n
```

Lint the codebase:

```bash
npm run lint
```

Check Android release prerequisites:

```bash
npm run check:android:release-env
```

Notes:

- `npm install` runs `patch-package` and rebuilds the local editor assets automatically.
- After changing native iOS dependencies, run `cd ios && pod install`.
- The public repository intentionally excludes private research and store-submission working material.
- `npm run check:public-hygiene` skips outside a git checkout and becomes an enforcement guard once a real public repository exists.

## Core Commands

```bash
npm start
npm run android
npm run ios
npm run check:android:release-env
npm run build:android:release
npm run check:public-hygiene
npm run check:i18n
npm run lint
npm run typecheck
npm run test:watch
npm test -- --runInBand
npm run verify
```

## Architecture Overview

Kavi is organized around a few major subsystems:

- `src/screens`: user-facing mobile screens
- `src/engine`: orchestration loop, tool management, and runtime policies
- `src/services`: providers, storage, integrations, local runtime, MCP, Expo/EAS, SSH, media, and workflow services
- `src/store`: persisted app state and hydration logic
- `__tests__`: unit, integration, screen, and Android contract tests

The app is mobile-first by design. Some features rely on remote services or external credentials, while others are intended to run locally on-device.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/setup/development.md](docs/setup/development.md)
- [docs/testing.md](docs/testing.md)
- [docs/feature-matrix.md](docs/feature-matrix.md)
- [docs/privacy-policy.md](docs/privacy-policy.md)
- [docs/privacy-and-permissions.md](docs/privacy-and-permissions.md)
- [THIRD_PARTY_PROVENANCE.md](THIRD_PARTY_PROVENANCE.md)

## Testing

Kavi ships with a large Jest-based test suite. Most tests are local and deterministic. A small number of live-provider tests are opt-in and gated by environment variables so contributors do not accidentally hit paid or remote services.

Use the default local verification path before opening a pull request:

```bash
npm run verify
```

See [docs/testing.md](docs/testing.md) for the opt-in live-provider scripts and required API keys.

## Privacy & Long-term Memory

Kavi maintains an on-device single-thread memory store (facts, entities,
scoped focus blocks, episodes, and a recall index) so the assistant can
refer back to durable details across conversations. Durable memory is
stored locally in the app's SQLite database. Optional consolidation or
embedding providers can send selected turn windows or memory snippets to
the user-configured provider when those features are enabled.

You can fully disable long-term memory in **Settings → Data →
"Disable long-term memory"**. When the toggle is on:

- Living-memory bridge skips block reads and recall.
- The consolidator scheduler short-circuits before any extractor call.
- The migration backfill (v6→v7 archived threads) is a no-op.
- Legacy file-backed memory is not injected into prompts.
- Every `memory_*` engine tool returns
  `{ ok: false, code: 'permission_denied' }` so the agent reacts
  gracefully instead of failing opaquely.

The optional consolidation extractor is configured via
`Settings → Models → Consolidation provider` and uses an
OpenAI-compatible `/v1/chat/completions` call. Misconfigured providers
no-op cleanly.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before starting work. It covers setup expectations, generated assets, patches, testing, and pull request standards.

## Security

Please read [SECURITY.md](SECURITY.md) before reporting vulnerabilities. Do not open public issues for security-sensitive problems.

## Code of Conduct

This project follows the standards in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Kavi is released under the [MIT License](LICENSE).
