# Changelog

All notable changes to Kavi will be documented in this file.

The format is based on Keep a Changelog, and this project follows semantic
versioning where practical for tagged releases.

## [1.0.0] - 2026-06-20

### Added

- Mobile-first assistant app for iOS and Android with direct chat, agentic
  workflows, conversation workspaces, attachments, and voice input.
- Structured tool orchestration for local app actions, MCP servers, SSH
  sessions, browser automation, remote workspaces, and Expo/EAS workflows.
- ClawHub-compatible skill discovery and installation while keeping MCP runtime
  surfaces available for public integrations.
- On-device Gemma runtime support with native integration, runtime selection,
  installation checks, and fallback handling.
- Long-term memory with local fact, entity, focus, episode, recall, and
  task-scoped context storage.
- Public contributor documentation for development setup, testing, privacy,
  permissions, release checks, third-party notices, and provenance.

### Changed

- Public documentation now describes contributor setup, verification tiers,
  release readiness, and maintainer-owned signing responsibilities without
  requiring private context.
- Default verification now runs public hygiene, public language, Markdown link
  validation, dependency license checks, app metadata checks, i18n consistency,
  structural guards, lint, typecheck, and the Jest suite.
- Generated editor assets remain committed and reproducible so native builds do
  not depend on runtime bundling.
- App, package, native, and MCP client metadata are aligned at version `1.0.0`
  while retaining the current iOS and Android application identifiers.

### Security

- Added public repository hygiene checks for ignored private material,
  generated output, local artifacts, tracked secret patterns, and
  public-facing language.
- Documented private vulnerability reporting expectations and
  sensitive-data-handling guidance.
- Added dependency license inventory checks and generated third-party notices.
- Kept signing material, local environment files, generated reports, and
  release artifacts out of the public tree.

### Tests

- Default contributor verification runs the local Jest suite, lint, typecheck,
  documentation link checks, license checks, metadata checks, and public
  repository guardrails.
- Added durable coverage for public-readiness checks, dependency license
  inventory, GitHub workflow hardening, contributor documentation, and release
  checklist expectations.
- Retained strict maintainer gates for memory, agent, and live E2E validation
  without requiring provider credentials for ordinary pull requests.
