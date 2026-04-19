# Changelog

All notable changes to Kavi will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning where practical for tagged releases.

## [Unreleased]

### Added

- Public repository baseline files: README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, LICENSE, and CHANGELOG
- GitHub issue templates, pull request template, and baseline CI workflow
- `npm run verify` as the default local verification command
- `THIRD_PARTY_PROVENANCE.md` for source and patch attribution tracking
- `ARCHITECTURE.md` plus contributor docs for development setup, testing, privacy, and feature support
- `.nvmrc` and CI pinning to the documented Node baseline

### Changed

- Expanded `.gitignore` coverage for private work products, native outputs, caches, and coverage artifacts
- Sanitized shipped locale placeholders to remove maintainer-specific usernames and local paths
- Removed source-provenance wording from contributor-facing source comments
- Replaced the hardcoded Android release build environment with an environment-driven wrapper and preflight check
