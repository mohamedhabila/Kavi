# Maintainer Release And Repository Checklist

This checklist covers repository-host settings and maintainer-only release gates that cannot be fully represented in git. Review it before making the repository public, before changing the default branch rules, and before each tagged release.

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
- Enable code scanning when available, or document why it is not enabled for the
  current repository host and plan.
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
- Run `npm run check:licenses` after dependency changes and commit regenerated `THIRD_PARTY_NOTICES.md` when it changes.
- Run `npm run check:links`.
- Confirm app metadata and native identifiers with `npm run check:app-metadata`.
- Run the public-safe Android release environment check with
  `npm run check:android:release-env`.
- Run iOS simulator release validation with `npm run build:ios:release-sim`
  on a macOS machine with the required Xcode toolchain.
- Review [THIRD_PARTY_PROVENANCE.md](../THIRD_PARTY_PROVENANCE.md) when dependency patches, generated assets, or attribution-sensitive files change.
- Confirm Android signing material is configured only in maintainer-local
  storage. Use local `android/keystore.properties` or the
  `KAVI_UPLOAD_STORE_FILE`, `KAVI_UPLOAD_STORE_PASSWORD`,
  `KAVI_UPLOAD_KEY_ALIAS`, and `KAVI_UPLOAD_KEY_PASSWORD` environment variables;
  never commit signing material.
- Build signed Android artifacts only from a maintainer signing environment:
  `npm run build:android:release` for APK output and
  `npm run build:android:aab` for App Bundle output.
- Confirm release artifacts, signing keys, credentials, `.env.local`, and maintainer-only working material are not tracked.
- Store generated release artifacts outside git. The local export path
  `release-artifacts/` is ignored and must remain untracked.
- Update [CHANGELOG.md](../CHANGELOG.md) for user-visible changes.
- Confirm the release version in [package.json](../package.json),
  [app.json](../app.json), and native metadata matches the intended tag.

## Tagging And GitHub Release

After release readiness passes:

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
