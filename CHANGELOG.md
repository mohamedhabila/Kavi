# Changelog

All notable changes to Kavi will be documented in this file.

The format is based on Keep a Changelog, and this project follows semantic
versioning where practical for tagged releases.

## [1.0.0] - 2026-06-20

### Added

- Mobile-only assistant app for iOS and Android with direct chat, agentic
  workflows, conversation workspaces, attachments, voice input, and no required
  Kavi server or gateway for core use.
- Structured tool orchestration for local app actions, MCP servers, SSH
  sessions, browser automation, remote workspaces, and Expo/EAS workflows.
- ClawHub-compatible skill discovery and installation while keeping MCP runtime
  surfaces available for public integrations.
- On-device Gemma runtime support with native integration, runtime selection,
  installation checks, and fallback handling.
- Long-term memory with local fact, entity, focus, episode, recall, and
  task-scoped context storage.
- Explicit, user-authorized preservation of bounded source text for exact
  cross-conversation recall, with local withdrawal and memory opt-out controls.
- Public contributor documentation for development setup, testing, privacy,
  permissions, release checks, third-party notices, and provenance.

### Changed

- Documentation now describes contributor setup, verification tiers, optional
  remote integrations, and maintainer-owned signing responsibilities.
- Default verification now runs public hygiene, public language, Markdown link
  validation, dependency license checks, app metadata checks, i18n consistency,
  structural guards, lint, typecheck, and the Jest suite.
- Generated editor assets remain committed and reproducible so native builds do
  not depend on runtime bundling.
- The terminal renderer and addons are now generated from pinned npm inputs and
  bundled into both platform assets, so the local terminal does not load
  executable code from a runtime CDN.
- Python automation now requires explicit per-invocation network authority,
  routes supported HTTP through the native URL, bounded redirect, and
  response-size policy, and reports content-free network-effect evidence to
  durable execution receipts.
- Effect-free Python interpreter failures remain ordinary failed computations
  that the agent can recover from, while possible or indeterminate external
  mutations continue to require reconciliation.
- Intermediate provider tool markup is hidden when the same turn already has a
  structured tool call, while ordinary final-answer content is preserved.
- App, package, native, and MCP client metadata are aligned at version `1.0.0`
  while retaining the current iOS and Android application identifiers.
- iOS EventKit permission metadata now covers both calendar and reminder
  requesters so release builds can initialize the calendar module safely.
- Preserve explicitly trusted MCP read/write and effect metadata through
  dynamic tool discovery instead of reducing every integration tool to an
  unknown discovery capability.
- Keep empty category searches inside their requested boundary while returning
  structured alternative-category guidance, with one bounded reconsideration
  before integration-owned work is handed back to the user.
- Record successful mutating MCP returns as unverified acknowledgements so the
  assistant can perform a safe read-back without treating opaque result content
  as completion evidence or automatically replaying an uncertain mutation.

### Security

- Added repository hygiene checks for ignored local material, generated output,
  local artifacts, tracked secret patterns, and contributor-facing language.
- Documented private vulnerability reporting expectations and
  sensitive-data-handling guidance.
- Added dependency license inventory checks and generated third-party notices.
- Kept signing material, local environment files, generated reports, and
  release artifacts out of the public tree.
- Updated vulnerable direct and lockfile dependency resolutions without forcing
  incompatible MCP or Expo downgrades; remaining moderate transitive advisories
  and their reachability are documented in the release checklist.

### Tests

- Default contributor verification runs the local Jest suite, lint, typecheck,
  documentation link checks, license checks, metadata checks, and repository
  guardrails.
- Added durable coverage for repository hygiene checks, dependency license
  inventory, GitHub workflow hardening, contributor documentation, and release
  checklist expectations.
- App metadata checks now reject missing or divergent native iOS usage
  descriptions before a release artifact is built.
- Retained strict maintainer gates for memory, agent, and live E2E validation
  without requiring provider credentials for ordinary pull requests.
