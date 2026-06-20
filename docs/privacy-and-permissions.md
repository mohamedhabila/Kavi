# Privacy And Permissions

This document explains what Kavi stores locally, what can be sent to remote systems, and why the mobile app requests sensitive permissions.

## Principle

Kavi should only access sensitive device data or remote systems when the user explicitly requests a feature that needs it.

Kavi's core assistant runtime is mobile-owned. It does not require a
Kavi-operated server or gateway; remote systems appear only when the user
configures a provider, MCP server, SSH target, browser worker, workspace, or
other integration.

## Local Data

Kavi stores application state locally for usability and continuity.

Examples include:

- conversation history and drafts
- non-secret settings
- workflow state and local metadata
- generated artifacts tied to active conversations or tools

Secrets such as provider API keys, remote access tokens, and private SSH material are intended to flow through secure-storage abstractions rather than the plain persisted settings store.

## Remote Data Flows

Depending on configuration, Kavi may send user-provided content to:

- LLM provider APIs
- remote MCP servers
- SSH targets
- browser automation providers
- remote workspace URLs
- Expo / EAS endpoints

The app does not require these systems. They are optional execution surfaces
configured by the user.

## On-Device Model Behavior

When an on-device model is selected, inference can remain on the device instead of calling a remote provider. This improves privacy for supported workflows, but it does not automatically cover every feature or attachment path.

## Permission Map

| Permission area        | Why Kavi asks for it                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| Microphone             | Voice input, voice notes, and user-requested audio capture.                 |
| Camera                 | Capturing an image or short video clip for a conversation or tool action.   |
| Photos / media library | Selecting images or other supported media for attachments.                  |
| Contacts               | User-requested contact selection or contact-aware actions.                  |
| Calendar               | User-requested event lookup or calendar creation/update flows.              |
| Location               | User-requested map or location-aware actions.                               |
| Notifications          | Scheduled reminders, background workflow notifications, and status updates. |

## Contributor Expectations

- Do not expand permission scope casually.
- Keep permission prompts tied to clear user-triggered actions.
- Document every new permission in `app.json`, this file, and release notes.
- Treat provider credentials, SSH private keys, and remote access tokens as sensitive material in every test and log path.

## Repository Hygiene

- Never commit real credentials, signed URLs, or private infrastructure endpoints.
- Avoid posting raw logs that contain personal, provider, or remote-host data in issues or pull requests.
- Keep scratch planning material out of git history.
