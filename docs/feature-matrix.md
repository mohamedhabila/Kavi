# Feature Matrix

This matrix is for contributors and integrators who need a current map of
Kavi's public capability surface. It describes the mobile app, optional
integrations, and the verification areas to check when a feature changes.

Kavi is a mobile-only assistant for iOS and Android. Core assistant use does
not require a Kavi server, hosted gateway, desktop companion, or private
infrastructure. Rows that mention providers, remote hosts, browsers, workspaces,
MCP servers, GitHub, or Expo/EAS refer to user-configured integrations.

This is a support map, not a promise that every workflow behaves identically on
every device. Device permissions, operating system behavior, model support,
provider limits, and remote service health can all affect individual workflows.

## Status Terms

- `Available`: works in normal app flows without third-party account setup
  beyond installing and configuring the app.
- `Permission-gated`: requires an explicit mobile permission before Kavi can
  use the device surface.
- `Setup required`: requires credentials, a remote endpoint, an account, a
  model install, or project-specific configuration.
- `Platform-specific`: intentionally available on one mobile platform only.

## Capability Matrix

| Capability | iOS | Android | Status | Setup and limits | Verification focus |
| --- | --- | --- | --- | --- | --- |
| Core chat UI and conversation history | Yes | Yes | Available | Stored locally in the app. No Kavi backend is required for the base chat surface. | Screen, store, persistence, and public metadata tests. |
| Agentic workflows and built-in tools | Yes | Yes | Available | Runs through the mobile orchestration graph with explicit tool contracts and local state. | `npm run verify`, graph tests, tool contract tests, and focused regression tests for changed tools. |
| Hosted model providers | Yes | Yes | Setup required | Requires user-provided provider credentials. Available model features vary by provider. | Provider unit tests, opt-in live-provider tests, and E2E gates when provider behavior changes. |
| On-device local model runtime | Yes | Yes | Setup required | Requires supported device capability and installed model assets. Model size and acceleration support affect UX. | Local runtime tests plus platform-specific native checks for runtime, packaging, and recovery behavior. |
| Local long-term memory | Yes | Yes | Available | Stored on-device in SQLite and can be disabled in Settings. Optional consolidation or embedding features may call a configured provider. | Memory policy, retrieval, ingestion, opt-out, and acceptance metric tests. |
| MCP client and tool bridge | Yes | Yes | Setup required | Requires reachable MCP servers and any required authentication. OAuth-capable flows remain user-configured. | MCP transport, metadata, OAuth, status, and tool-bridge tests. |
| ClawHub-compatible skills | Yes | Yes | Setup required | ClawHub remains a supported source for skills; installed skills run through the mobile skill manager. Registry browsing depends on network access and configured endpoints. | Skill discovery, manifest, routing, prompt injection, and tool eligibility tests. |
| Conversation workspaces and files | Yes | Yes | Available | Conversation-scoped workspace files are app-owned and local unless a configured integration moves data elsewhere. | Workspace file, ownership, attachment, and result-normalization tests. |
| Canvas and generated HTML tools | Yes | Yes | Available | Canvas content runs inside app WebView surfaces. These tools are for user-created or user-opened content, not for running untrusted code. | Canvas renderer, source storage, WebView bridge, and dynamic execution trust-boundary tests. |
| Remote browser automation | Yes | Yes | Setup required | Requires a configured browser provider such as Browserbase-compatible or Browserless-compatible infrastructure. | Browser provider readiness, job orchestration, traces, screenshots, and result-shape tests. |
| SSH, SFTP, and SSH terminal sessions | Yes | Yes | Setup required | Requires a reachable host, accepted host key policy, and user-supplied credentials or key material. | SSH connector, session store, terminal, SFTP, and platform safety tests. |
| Local shell/runtime execution | No | Yes | Platform-specific | Android has the local native runtime path. iOS workflows should use hosted providers, SSH targets, workspaces, or other configured integrations instead. | Android runtime tests; ensure iOS paths fail gracefully. |
| GitHub repository, issue, pull request, and workflow tools | Yes | Yes | Setup required | Requires a GitHub token with the minimum scopes needed for the requested action. | GitHub integration tests, workflow status tests, token-scope handling, and tool contract tests. |
| Expo/EAS project automation | Yes | Yes | Setup required | Requires Expo credentials and project configuration. Some flows also use GitHub Actions or SSH-backed project checks. | Expo/EAS readiness, hosted workflow, GraphQL, logs, release checklist, and native config tests. |
| Voice input, voice notes, and speech playback | Yes | Yes | Permission-gated | Requires microphone permission for recording. Transcription or non-system speech may require configured provider credentials. | Voice recording, voice note, talk mode, transcription, playback, and permission tests. |
| Camera, media attachments, and media understanding | Yes | Yes | Permission-gated | Requires camera or media-library permissions when capturing or selecting media. Provider-side media support depends on the active model. | Media attachment, camera, image generation, image editing, and provider capability tests. |
| Calendar, contacts, clipboard, sharing, location, notifications, and device-state tools | Yes | Yes | Permission-gated | Native data is accessed only for user-requested actions and only after the relevant permission or OS capability is available. | Native tool executors, permission-denial paths, fixture-backed mobile scenarios, and privacy docs. |
| Scheduled workflows and reminders | Yes | Yes | Permission-gated | User-visible reminders and background status updates depend on notification permission and OS scheduling behavior. | Scheduler engine, notification service, background workflow, and navigation-route tests. |
| Dynamic JavaScript and workspace code execution | Yes | Yes | Available | Intended for trusted user/tool automation. These execution surfaces are documented trust boundaries, not security sandboxes. | `docs/dynamic-code-execution.md`, JavaScript utility tests, workspace bridge tests, and canvas eval tests. |

## Public Caveats

- Mobile is the product surface. Web metadata exists for Expo defaults, but the
  public app target is iOS and Android.
- Optional integrations can send user-selected content to third-party systems
  that the user configures. See [privacy-and-permissions.md](privacy-and-permissions.md)
  and [privacy-policy.md](privacy-policy.md).
- A `Yes` entry means Kavi has a supported app path for that platform. It does
  not mean every provider, model, remote host, or operating system version
  supports every sub-feature.
- Dynamic code execution surfaces are developer and tool automation features.
  Do not treat them as sandboxes for untrusted remote code.
- Provider-specific behavior belongs behind capability checks and setup
  validation, not hard-coded assumptions.

## Contributor Validation Checklist

Use the smallest focused test set that proves the changed behavior, then run the
repository gate before opening a pull request:

```bash
npm run verify
```

Additional checks by change type:

| Change area | Additional validation |
| --- | --- |
| Agent graph, tool routing, memory, or orchestration | Run focused regression tests and consider `npm run verify:strict` before maintainer review. |
| Native permissions or device surfaces | Update `app.json`, this matrix, privacy docs, release notes when relevant, and native fixture tests. |
| Provider, MCP, SSH, browser, GitHub, Expo, or remote workspace integrations | Cover setup validation, missing-credential behavior, error states, and result redaction. Use opt-in live tests only when credentials are intentionally configured. |
| Expo SDK, React Native, native dependency, or build-tool changes | Verify dependency installation from a clean lockfile and run the relevant iOS/Android build or environment checks. Do not merge SDK-major or native-major changes without platform proof. |
| Dynamic execution surfaces | Keep the trust boundary documented and add tests for input normalization, allowed APIs, denied APIs, and error propagation. |
| Public documentation | Run link and public-language checks through `npm run verify`; avoid private planning language, unsupported performance claims, and stale roadmap details. |

For the full testing model, see [testing.md](testing.md).
