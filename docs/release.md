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
- Resolved 2026-09-06: the moderate advisory
  [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq),
  reached through Expo's build-time
  `@expo/config-plugins -> xcode@3.0.1 -> uuid@7.0.3` chain (npm expanded that
  one chain into eight findings across `@expo/cli`, `@expo/config`,
  `@expo/config-plugins`, `@expo/local-build-cache-provider`,
  `@expo/metro-config`, `@expo/prebuild-config`, `expo`, and `expo-sharing`),
  is now fixed with a scoped `package.json` `overrides` entry pinning `uuid`
  to `^11.1.1` only within `xcode`'s dependency subtree. `xcode` is the sole
  consumer of `uuid` in the tree, its only usage (`uuid.v4()` in
  `lib/pbxProject.js`) is a named-export call stable across uuid's CJS builds
  from v8 through v14, and `npx expo install --check` still reports
  dependencies up to date after the override. No stale accepted-risk note is
  needed for this advisory going forward.
- The lockfile selects patched `brace-expansion@1.1.18` for legacy
  `glob@7 -> minimatch@3` build-tool callers and patched modern releases for
  newer callers, resolving
  [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
  without an unsupported Expo or React Native upgrade. Keep both high-severity
  audit commands green whenever Expo, React Native, Jest, `glob`, `minimatch`,
  or `brace-expansion` changes.
- Run the Android release environment check with
  `npm run check:android:release-env`.
- Run iOS simulator release validation with `npm run build:ios:release-sim`
  on a macOS machine with the required Xcode and CocoaPods toolchains. The
  command prepares the locked pods in deployment mode before compiling. It
  builds an arm64 simulator app because the pinned LiteRT-LM binary supports
  only the arm64 simulator architecture. This command-line override does not
  change iOS device archive architectures. The installed iOS Simulator runtime
  must also be compatible with Xcode's selected platform SDK; a mismatched or
  missing runtime can reject the destination before source compilation begins.
- Review [THIRD_PARTY_PROVENANCE.md](../THIRD_PARTY_PROVENANCE.md) when dependency patches, generated assets, or attribution-sensitive files change.

### Dependency Advisories (accepted risk, reviewed 2026-09-06)

`npm audit --omit=dev --audit-level=high` still reports 11 advisories (7
moderate, 4 high) after `npm audit fix` and the `uuid` override above. No
further semver-compatible fix exists upstream for either cluster below; both
are accepted as risk rather than blocking the release gate. Re-review this
list whenever `@react-navigation/*`, `metro`, `image-size`, or their
transitive advisories change.

- **`@react-navigation/core`, `@react-navigation/drawer`,
  `@react-navigation/elements`, `@react-navigation/native`,
  `@react-navigation/native-stack`, `query-string`, `decode-uri-component`**
  (moderate) — [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
  (`decode-uri-component` ReDoS via malformed percent-encoded input), reached
  through `@react-navigation/core -> query-string@7.1.3 ->
  decode-uri-component@0.2.2`. `npm audit` reports no fix: the newest
  `@react-navigation/core` still pins `query-string@^7.1.3`, and
  `decode-uri-component@0.5.0` (the only patched release) dropped its
  CommonJS build (`"type": "module"`, no `main`/`require` export), which would
  break `query-string`'s `require('decode-uri-component')` call at runtime.
  Not reachable in Kavi: `decode-uri-component` is only exercised by
  `@react-navigation/core`'s `getStateFromPath`/`getPathFromState`, which run
  only when `NavigationContainer` is given a `linking` config.
  `src/navigation/AppNavigator.tsx` renders `NavigationContainer` with no
  `linking` prop, and no code in `src/` wires an OS deep link
  (`Linking.addEventListener('url', ...)`) into navigation state, so this
  parsing path never runs against external input.
- **`image-size`, `metro`, `metro-config`, `metro-transform-worker`** (high) —
  [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and
  [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
  (`image-size` ICNS/JXL/HEIF parser infinite loops), reached through
  `react-native -> @react-native/community-cli-plugin -> metro -> image-size`.
  The advisory range covers every published `image-size` version through the
  current latest (`<=2.0.2`); there is no patched release to move to or
  override to. `metro`, `metro-config`, and `metro-transform-worker` are
  flagged solely because they depend on vulnerable `image-size`, not for a
  defect of their own. This is already mitigated in-tree:
  `patches/image-size+1.2.1.patch`, applied automatically by `patch-package`
  during `postinstall`, patches the compiled ICNS, JXL, and HEIF parsers to
  guarantee forward progress on a malformed/crafted box or entry instead of
  looping forever, and `__tests__/scripts/imageSizeParserHardening.test.ts`
  regression-guards that the patch stays applied. `npm audit` cannot see
  local patches, so it keeps reporting these four findings against the
  unpatched upstream version until a real upstream release fixes the parsers;
  the residual risk is otherwise low regardless, since all four packages are
  Metro bundler build-time tooling that runs on the developer/CI machine and
  does not ship in the compiled app bundle. Keep the patch and its regression
  test in sync whenever `image-size` or `metro` changes version.
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
