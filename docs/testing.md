# Testing Guide

Kavi has a large Jest-based test suite and a smaller set of environment-dependent or manually validated flows.

## Default Local Gate

Run this before opening a pull request:

```bash
npm run verify
```

That command currently runs:

- ESLint
- TypeScript type checking
- Jest in `--runInBand` mode

## Common Commands

Run the full suite directly:

```bash
npm test -- --runInBand
```

Run lint only:

```bash
npm run lint
```

Run Jest in watch mode:

```bash
npm run test:watch
```

Run a single file:

```bash
npm test -- --runInBand __tests__/screens/RemoteWorkScreen.test.tsx
```

Run a name-filtered subset:

```bash
npm test -- --runInBand --testNamePattern="workspace"
```

## Test Categories

- `__tests__/screens`: UI and screen interaction coverage
- `__tests__/components`: component rendering and behavior coverage
- `__tests__/services`: service, integration, transport, storage, and workflow logic
- `__tests__/engine`: orchestration, tool, and execution-guard coverage
- `__tests__/android`: Android-specific contracts and release hardening checks
- `__tests__/integration`: broader scenario tests that still run in the local Jest environment

## Expectations For Contributors

- Add or update regression tests when behavior changes.
- Prefer narrow tests close to the changed subsystem before adding heavyweight scenario coverage.
- Keep default CI-safe tests local and deterministic.
- If a test requires paid providers, private infrastructure, or platform-specific external dependencies, keep it opt-in and gated explicitly.

## Opt-In Live Provider Tests

Two Jest files intentionally call real hosted providers and are excluded from the default contributor gate unless you opt in explicitly:

- `__tests__/services/LlmService.anthropic.live.test.ts`
- `__tests__/services/LlmService.nativeProviders.live.test.ts`

These tests are not part of CI and should only be run when you are validating provider integrations or investigating transport regressions.

Required environment variables:

- `npm run test:live:anthropic`: requires `ANTHROPIC_API_KEY`
- `npm run test:live:native-providers`: requires `ANTHROPIC_API_KEY` and one of `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`

Recommended workflow:

1. Export the required API keys in your shell or secret manager.
2. Run the matching npm script.
3. Unset the keys again when you are done if your shell session is shared.

These tests can incur provider costs, depend on external network health, and may fail for reasons unrelated to local code changes.

## Current Noise Level

The default `npm test -- --runInBand` run is now quiet in the current workspace. The earlier `act(...)` and StrictMode `findNodeHandle` warning noise has been cleaned up from the default green path.

The main routine noise left in `npm run verify` is currently from ESLint `react-hooks/exhaustive-deps` warnings rather than Jest renderer warnings. If you are already editing the affected screens or hooks, reducing those lint warnings is still valuable contribution work.

## Release-Oriented Validation

For Android release work, run:

```bash
npm run check:android:release-env
npm run build:android:release
```

For iOS simulator release validation, run:

```bash
npm run build:ios:release-sim
```
