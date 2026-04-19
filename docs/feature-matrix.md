# Feature Matrix

This matrix is intended for contributors. It reflects current project intent and contributor expectations, not a compatibility warranty.

## Support Levels

- `Supported`: expected to work in normal contributor and user flows.
- `Supported with setup`: requires credentials, external services, or platform-specific tooling.
- `Active hardening`: available and tested, but still a moving target for architecture and polish.
- `Experimental`: intentionally exposed but not yet considered stable.

## Capability Matrix

| Capability                                           | iOS | Android | Support level        | Notes                                                                                    |
| ---------------------------------------------------- | --- | ------- | -------------------- | ---------------------------------------------------------------------------------------- |
| Core chat UI and conversation history                | Yes | Yes     | Supported            | Main product surface.                                                                    |
| Frontier provider chat via HTTP APIs                 | Yes | Yes     | Supported with setup | Requires provider credentials.                                                           |
| Tool-assisted chat and agentic workflows             | Yes | Yes     | Active hardening     | Large orchestration surface; heavily tested but still evolving.                          |
| On-device Gemma runtime                              | Yes | Yes     | Active hardening     | Device capability and model size materially affect UX.                                   |
| MCP client and tool bridge                           | Yes | Yes     | Supported with setup | Requires reachable MCP endpoints and any needed auth.                                    |
| SSH targets and SFTP-backed operations               | Yes | Yes     | Supported with setup | Depends on remote host configuration and secure credentials.                             |
| Remote browser provider control                      | Yes | Yes     | Active hardening     | Supports Browserbase and Browserless style workflows.                                    |
| Remote workspace launch and delegation               | Yes | Yes     | Active hardening     | Requires a reachable remote IDE surface and, for some flows, linked SSH/browser targets. |
| Voice input and voice notes                          | Yes | Yes     | Supported            | Requires microphone permission.                                                          |
| Image and document attachments                       | Yes | Yes     | Supported            | Some provider features depend on model capabilities.                                     |
| Calendar, contacts, location, and notification tools | Yes | Yes     | Supported with setup | Permission-gated and user-request driven.                                                |
| Expo / EAS automation                                | Yes | Yes     | Supported with setup | Requires Expo credentials and remote project configuration.                              |
| Gateway node connectivity                            | Yes | Yes     | Experimental         | Useful, but not yet a fully stabilized public surface.                                   |
| Local shell execution                                | No  | Yes     | Supported with setup | Android-only local shell path is tied to the local runtime environment.                  |
| SSH shell terminal UI                                | Yes | Yes     | Supported with setup | Shared terminal UI works on both platforms once a remote SSH target exists.              |

## Contributor Priorities

If you want to improve the project quickly, the highest-leverage areas are:

1. test-noise reduction in screen suites
2. refactoring the very large screen and orchestration files
3. hardening remote work flows and setup validation
4. improving on-device runtime clarity and failure recovery
