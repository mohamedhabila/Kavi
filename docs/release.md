# Maintainer Release And Repository Checklist

This checklist covers repository-host settings and maintainer-only release gates
that cannot be fully represented in git. Review it before changing default
branch rules and before each tagged release.

## Default Branch Protection

Configure branch protection or repository rules for the default branch:

- Require pull requests before merging.
- Require at least one approving review from a maintainer.
- Require review from code owners when a `CODEOWNERS` file is added.
- Dismiss stale approvals after new commits when the repository host supports it.
- Require conversation resolution before merge.
- Require branches to be up to date before merge when this does not create excessive maintainer friction.
- Restrict force-pushes and branch deletion on the default branch.
- Allow administrators to bypass only for documented emergency fixes.

## Required Checks

Set required checks for the default branch to match the public contributor gate:

- Require the CI workflow job that runs `npm run verify`.
- Keep the required check name in branch protection synchronized with `.github/workflows/ci.yml` after workflow renames.
- Treat `npm run verify` as the merge baseline for ordinary pull requests.
- Use `npm run verify:strict` for maintainer validation of agent, graph, memory, orchestration, or E2E harness changes when risk warrants it.
- Do not require live-provider E2E checks for all outside contributors; those checks need maintainer-managed secrets and remain nightly or manually dispatched.

## Security Settings

Enable the repository host security features available to the project:

- Enable private vulnerability reporting.
- Enable Dependabot alerts.
- Enable Dependabot security updates.
- Keep `.github/dependabot.yml` enabled for npm and GitHub Actions maintenance updates.
- Enable secret scanning when available.
- Enable push protection when available.
- Enable code scanning when available, or document why it is not enabled for
  the current repository hosting setup.
- Review pinned GitHub Actions in `.github/workflows/` during dependency-maintenance work.

## Public Contact Links

Keep public contact links current:

- Security reports must point contributors to [SECURITY.md](../SECURITY.md).
- Conduct reports must point contributors to [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).
- Issue templates should keep security-sensitive reports out of public issues.
- The repository profile or project metadata should expose a maintainer contact path when private vulnerability reporting is unavailable.

## Release Candidate Checklist

Before publishing a release candidate, start from the reviewed release branch or
tag candidate and run the release gate from a clean checkout.

- Confirm the tracked worktree is clean.
- Install from the lockfile with `npm ci`.
- Run the contributor gate with `npm run verify`.
- Run any targeted tests for the changed area.
- Run coverage with `npm run test:coverage`. Treat the configured coverage
  thresholds as a non-regression baseline; do not lower them for a release.
- Run production dependency audit with
  `npm audit --omit=dev --audit-level=high`.
- Run full dependency audit with `npm audit --audit-level=high`.
- Review moderate advisories with `npm audit --audit-level=moderate` before
  major public releases and after dependency-tree changes. Moderate advisories
  do not automatically block every release, but they must be fixed or
  documented before release when they affect runtime dependencies, credentials,
  network input, local file access, native build tooling, code execution, or
  package integrity.
- Run `npm run check:licenses` after dependency changes and commit regenerated `THIRD_PARTY_NOTICES.md` when it changes.
- Run `npm run check:links`.
- Confirm app metadata and native identifiers with `npm run check:app-metadata`.
- Confirm the SDK dependency matrix with `npm run check:expo-dependencies`.
  `react-native-gesture-handler` is intentionally excluded from Expo's
  best-effort version catalog: the catalog's 2.30.1 release does not compile
  against SDK 55's React Native 0.83.10 and Kotlin 2.3 toolchain, while 2.31.2
  contains the upstream compiler fix and subsequent Android accessibility
  fixes. The repository check binds this exception to the exact native-build-
  validated Expo, React Native, and Gesture Handler versions. Remove the
  exception before any SDK tuple change, run Expo's unfiltered check, and add a
  new exception only when the upstream incompatibility and both native build
  results are documented.
- The SDK 55 build graph currently retains the moderate advisory
  [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
  through Expo's build-time
  `@expo/config-plugins -> xcode@3.0.1 -> uuid@7.0.3` chain. npm expands that
  one chain into multiple findings. Kavi does not execute this package in the
  app runtime, and the `xcode` package calls `uuid.v4()` without the
  caller-provided buffer implicated by the advisory's affected APIs. This
  disposition must be reviewed whenever Expo, `xcode`, or `uuid` changes; it
  stops being acceptable if the call sites or reachability change, severity
  increases, or an SDK-compatible upstream fix becomes available.
- The SDK 55 / React Native 0.83.10 build graph currently retains the high
  advisory
  [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
  through legacy `glob@7 -> minimatch@3 -> brace-expansion@1` copies used by
  React Native codegen, the Expo CLI, and Jest coverage tooling. The affected
  expansion code is not part of Kavi's bundled chat runtime, and Kavi does not
  pass user or model content to these build-tool glob patterns. The compatible
  modern dependency graph is already on `minimatch@10.2.6 ->
brace-expansion@5.0.8`. npm's forced remediation proposes an unsupported
  React Native or Expo major change, while overriding legacy callers directly
  to `brace-expansion@5` is API-incompatible. This remains a failing high-audit
  gate, requires explicit release-owner signoff, and must be reviewed whenever
  Expo, React Native, Jest, `glob`, `minimatch`, or `brace-expansion` changes.
  Treat it as a release blocker if untrusted patterns can reach the affected
  tooling or a compatible upstream fix becomes available and is not adopted.
- Run the Android release environment check with
  `npm run check:android:release-env`.
- Run iOS simulator release validation with `npm run build:ios:release-sim`
  on a macOS machine with the required Xcode and CocoaPods toolchains. The
  command prepares the locked pods in deployment mode before compiling. It
  builds an arm64 simulator app because the pinned LiteRT-LM binary supports
  only the arm64 simulator architecture. This command-line override does not
  change iOS device archive architectures.
- Review [THIRD_PARTY_PROVENANCE.md](../THIRD_PARTY_PROVENANCE.md) when dependency patches, generated assets, or attribution-sensitive files change.
- Confirm Android signing material is configured only in maintainer-local
  storage. Use local `android/keystore.properties` or the
  `KAVI_UPLOAD_STORE_FILE`, `KAVI_UPLOAD_STORE_PASSWORD`,
  `KAVI_UPLOAD_KEY_ALIAS`, and `KAVI_UPLOAD_KEY_PASSWORD` environment variables;
  never commit signing material.
- Build signed Android artifacts only from a maintainer signing environment:
  `npm run build:android:release` for APK output and
  `npm run build:android:aab` for App Bundle output.
- Confirm release artifacts, signing keys, credentials, `.env.local`, and local
  scratch material are not tracked.
- Store generated release artifacts outside git. The local export path
  `release-artifacts/` is ignored and must remain untracked.
- Update [CHANGELOG.md](../CHANGELOG.md) for user-visible changes.
- Confirm the release version in [package.json](../package.json),
  [app.json](../app.json), and native metadata matches the intended tag.

## Tagging And GitHub Release

After release validation passes:

- Create an annotated version tag such as
  `git tag -a vX.Y.Z -m "Kavi X.Y.Z"`.
- Push the reviewed commit and tag through the normal protected-branch release
  process.
- Create the GitHub release from the reviewed tag.
- Include the changelog summary, verification commands, known limitations, and
  artifact checksums when artifacts are attached.
- Attach only release artifacts built from the tagged commit.
- Do not attach signing keys, credentials, `.env.local`, maintainer notes, or
  local diagnostic artifacts.

## After Release

After tagging or publishing:

- Confirm the release tag points at the reviewed commit.
- Confirm required checks passed for the release commit.
- Confirm generated release artifacts are stored outside git.
- Confirm the GitHub release links to the intended tag and public changelog
  entry.
- Review Dependabot and security alerts for new items introduced by the release branch.
