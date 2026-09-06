# Kavi User Guide

This guide is for people using the Kavi app, not for developers. If you are
looking for technical or contributor documentation, see the
[feature matrix](feature-matrix.md), [privacy and permissions](privacy-and-permissions.md),
and [testing guide](testing.md) instead.

## First Launch

The first time you open Kavi, a short setup walks you through:

1. **Choose your AI provider.** Pick the provider Kavi should use for chat.
   You can add more, or change this, later in Settings. The interface follows
   your phone's language automatically; see
   [Changing your language](#changing-your-language) to pick a different one.
2. **Connect the provider.** For a hosted provider (OpenAI, Anthropic, Gemini,
   OpenRouter, or a custom OpenAI-compatible endpoint) you paste in an API key,
   which is stored securely on the device and is never sent anywhere except
   that provider. For the on-device option, Kavi downloads a supported local
   model to your phone instead of using an API key; this needs enough free
   storage and device memory, and can take a while over a slow connection.
   You can skip provider setup and finish it later from Settings.
3. **Explore optional services.** Web search, page extraction, weather,
   GitHub, and finance skills become available once you add their keys. All of
   these are optional and can be configured later.

Once setup finishes, you can start chatting right away.

## What Kavi Can Do On Your Phone

Kavi is a mobile-only assistant: it runs the assistant loop, tools, memory,
and native device actions in the app itself, without requiring a Kavi-hosted
server. Depending on which permissions you grant and which providers you
connect, Kavi can:

- **Answer and research.** Explain a topic, compare options, rewrite text, or
  work through a decision. When freshness matters, Kavi can search the web and
  keep its answer grounded in sources.
- **Manage reminders and calendar events.** Kavi can create, update, look up,
  or cancel reminders, delivered as real phone notifications even while the
  app is closed, once you allow notifications. Calendar events need the
  Calendar permission.
- **Work with your contacts.** Kavi can open the native contact picker to
  select a contact, or look up and open a contact you choose, after you grant
  the Contacts permission. Kavi only sees the contacts you explicitly select.
- **Use your location.** Kavi can read your current GPS location for
  location-aware answers, after you grant the Location permission.
- **Share content.** Kavi can hand text, links, or files to your phone's
  native share sheet so you can send them anywhere your phone already
  supports.
- **Work with photos and camera.** Kavi can open the system photo picker so
  you choose which images to share, or capture a photo or short video clip
  with the camera, after you grant the relevant permission. Kavi only sees the
  media you explicitly select or capture.
- **Remember things across conversations.** With long-term memory turned on,
  Kavi can keep useful preferences and details you share, and recall them in
  later conversations. See [How memory works](#how-memory-works) below.

Every one of these actions is permission-gated: Kavi only requests a device
permission when you ask for something that needs it, and native data is only
accessed for the specific action you requested.

## How Approvals Work

Before Kavi takes a sensitive action — like sending a message, creating or
changing a calendar event or reminder, or using a tool that touches your
device or an external service — it asks you to review and approve exactly
what it is about to do. This gives you a chance to check the details before
anything happens.

Some approvals can be turned into a standing permission ("always allow") so
Kavi does not ask again for the same kind of action. Every one of those saved
permissions is visible and can be revoked at any time:

1. Open **More > Privacy & permissions**, then **Approvals & permissions**.
2. Scroll to **Saved permissions**, which lists every tool or action you have
   allowed to run without asking again.
3. Tap the revoke control next to any entry to remove it. The next time Kavi
   wants to take that action, it will ask for approval again.

The same screen also shows your full approval history — every request Kavi
made, whether it was approved, rejected, or expired — so you can audit what
Kavi has actually done.

## Changing Your Language

Open **Settings > Appearance & language** to change the app's interface
language. Kavi currently supports English, Simplified Chinese, Traditional
Chinese, Brazilian Portuguese, German, Spanish, Arabic, French, and Japanese.

If you switch between a left-to-right language (such as English) and a
right-to-left language (such as Arabic), the layout direction only takes full
effect after you restart the app. If the app looks like it only partially
switched direction right after changing the language, close and reopen it.

## How Memory Works

When long-term memory is on, Kavi can remember details and preferences you
share — for example, a name, a preference, or a fact you asked it to
remember — and recall them in future conversations. Memory is stored locally
on your device.

- Open **Memory** (from More, or from Settings > Manage Memory) to see
  everything Kavi currently remembers about you, search it, and pin the
  entries you care about most.
- If something is wrong, tap a memory to **correct** it instead of leaving an
  inaccurate detail in place.
- To remove a single memory, tap **Forget** on that entry and confirm. This
  permanently removes it and cannot be undone.
- To remove everything at once, use **Clear All Memory** in the same screen.
  This permanently deletes every remembered fact, episode, and task, and
  cannot be undone.
- To stop Kavi from remembering anything new, turn on **Disable long-term
  memory** in Settings. While that switch is on, conversations stay stateless
  and no new facts are remembered.

Clearing memory and clearing conversation history are separate controls on
purpose: clearing your chat history does not clear memory, and clearing
memory does not clear your chat history. Deleting a provider or integration
separately removes its saved credentials.

## Reporting A Problem

If something in the app is broken, please open a bug report on the project's
GitHub Issues page and include what you were trying to do, what happened
instead, and your platform (Android or iOS).

If you believe you have found a security or privacy issue — anything that
could expose secrets, credentials, or private data, or that lets something
run somewhere it should not — please do **not** open a public issue. Follow
the private reporting instructions in [`SECURITY.md`](../SECURITY.md)
instead.
