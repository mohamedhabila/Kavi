# Contributing To Kavi

Thanks for contributing to Kavi.

This repository is an application codebase, not a library package. The goal for contributions is to keep the app stable for real-world use while continuing to improve architecture, test coverage, and contributor ergonomics.

## Before You Start

- Read [README.md](README.md) for the project overview and core commands.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the subsystem map.
- Read [docs/setup/development.md](docs/setup/development.md) and [docs/testing.md](docs/testing.md) before changing build or test workflows.
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

Check Android release prerequisites:

```bash
npm run check:android:release-env
```

## Verification

Run the default local verification path before opening a pull request:

```bash
npm run verify
```

This currently runs:

- ESLint
- TypeScript type checking
- Jest test suite in a contributor-safe mode

If you are working on a narrow area, run the targeted tests for that area too.

Useful supporting commands:

```bash
npm run check:public-hygiene
npm run lint
npm run test:watch
npm run format
```

## Generated Assets And Native Artifacts

Kavi includes generated editor assets and native build outputs.

- `npm install` automatically runs `patch-package` and rebuilds editor assets.
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
- Run `npm run check:public-hygiene` if the branch is intended to become part of a public repository.
- Make sure new files and docs use the public `Kavi` name consistently.
- Do not include private research notes, local credentials, or build artifacts.
- Keep `_research/` and other maintainer-private working material out of the public git history.

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
