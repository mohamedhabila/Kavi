# Store Submission Readiness

Reviewed: 2026-06-23

Status: No-go for App Store or Play Store submission until the launch blockers below are closed and verified on release builds.

This document is the submission-prep checklist for Kavi. It is based on the current repository state, the native manifests, existing privacy/release docs, and current Apple and Google policy references.

## Executive Verdict

Kavi is technically close to a release candidate: native identifiers are consistent, Android targets SDK 36, release signing is guarded, sensitive tool use has confirmation gates, release storage fails closed instead of writing secrets to plain storage, and the existing privacy docs are strong.

The remaining risk is not basic app quality. The main submission risks are policy fit and launch packaging:

- Google Play requires in-app reporting or flagging for AI-generated content.
- Apple and Google require public privacy/support URLs and clear in-app privacy access.
- Android photo/media access needs either a Play declaration or a reduced-permission implementation.
- Dynamic code, skills, terminal, browser, local runtime, and downloadable model surfaces need a conservative reviewer story.
- Expo dependency drift and release-build smoke evidence must be resolved before submission.

## Launch Blockers

| ID | Area | Required before submission | Current evidence |
| --- | --- | --- | --- |
| B1 | AI content reporting | Add an in-app "Report" or "Flag" flow for assistant-generated content. It must let users report generated text without leaving the app, and the team needs a moderation/triage process for those reports. | No user-facing report/flag action was found. Google Play's AI-generated content policy requires in-app reporting or flagging for AI-generated content. |
| B2 | Privacy and support URLs | Publish the privacy policy and support/contact page, then expose them from Settings/About and store metadata. | `docs/privacy-policy.md` exists, but no public URL or in-app policy/support link was confirmed. Apple requires privacy policy access in metadata and in the app. Google Play requires a privacy policy link in the Data safety section. |
| B3 | Local data deletion clarity | Either add a clear "Delete all local app data" flow or document the exact deletion controls in-app and in the privacy policy. | Conversations and memory can be cleared, and integrations can be removed, but no single full local-data wipe was confirmed. No first-party account exists, so account deletion rules are not triggered unless account creation is added. |
| B4 | Android photos/media permission | Decide whether to keep `READ_MEDIA_IMAGES`. If kept, prepare the Play Photos and videos permission declaration. If not essential, remove/refactor `photos_latest` to use system picker/share-sheet inputs only. | The release manifest declares `READ_MEDIA_IMAGES` and `READ_MEDIA_VISUAL_USER_SELECTED`. Google Play treats broad photo/video permissions as restricted and expects declaration approval when the picker is insufficient. |
| B5 | Dynamic execution and downloadable capability posture | Prepare reviewer notes and, if needed, limit first-release exposure of ClawHub skills, dynamic JavaScript/Python, terminal, and browser automation. Do not position the feature set as a plugin/app marketplace. Bundle release runtime assets instead of depending on CDN code at runtime where practical. | `docs/dynamic-code-execution.md`, the feature matrix, WebView runtime code, ClawHub/skills, SSH, terminal, browser, and local model surfaces create extra review risk. |
| B6 | Expo dependency health | Resolve or explicitly document the `expo-doctor` failures before release. Prefer a clean `expo-doctor` for submission builds. | `npx expo-doctor` reported 16/18 passing, with Expo SDK patch drift and an SSH/SFTP package not validated for the New Architecture. |
| B7 | Store assets and exact-build proof | Create final screenshots, listing copy, age/content ratings, export-compliance answers, and reviewer notes. Build the exact AAB/IPA/archive that will be submitted and smoke-test it on real devices. | No final store screenshots or fresh signed AAB/iOS archive evidence was found in the repository. |

## App Store Checklist

### Metadata

- App name: Kavi.
- Bundle identifier: `com.kavi.app`.
- Version/build in config: `1.0.0` / `1`.
- Category: choose a productivity or developer/productivity category that matches the final listing.
- Support URL: required before submission.
- Privacy policy URL: required before submission.
- Marketing URL: optional.
- Review notes: required for a complex app. Include a concise feature overview, no-login note, privacy model, permission triggers, and any reviewer setup steps.

### Privacy

Use `docs/privacy-policy.md` as the source, but publish it to a stable public URL and link it from the app.

Expected App Privacy posture, subject to final legal/product review:

- Tracking: No.
- Data linked to user: No, unless a first-party account or server-side identity is added.
- Data used for tracking: No.
- Data categories likely disclosed as collected or processed for app functionality: user content, photos/videos, audio, contacts, precise location, and possibly calendar data.
- Third-party AI/provider disclosure: required. Kavi can send user-selected prompts, files, tool outputs, images, audio, contacts, calendar data, or location to user-configured providers when the user enables those workflows.

Do not imply that Kavi has no data exposure just because it has no first-party backend. Store privacy disclosures must cover on-device processing and user-directed sharing with third-party providers.

### Permissions

Current iOS permission strings are present for:

- Camera.
- Microphone.
- Photo library.
- Contacts.
- Calendars.
- Location When In Use.

Before submission:

- Verify every permission prompt is triggered only by an intentional user action.
- Confirm denial paths are graceful.
- Confirm Contacts/Photos data is not sent to third-party AI without explicit user action and approval.
- Confirm `NSAppTransportSecurity` keeps arbitrary loads disabled in release.
- Confirm iOS background modes are necessary and accurately described in reviewer notes.

### Privacy Manifest

`ios/Kavi/PrivacyInfo.xcprivacy` currently declares:

- Tracking disabled.
- Required reason APIs for file timestamps, user defaults, system boot time, and disk space.
- Collected data categories for app functionality.

Before archive upload:

- Validate the generated archive includes merged privacy manifests from dependencies.
- Confirm required-reason API categories still match the final binary.
- Watch for App Store Connect privacy-manifest warnings after upload and resolve them before review.

### Dynamic Features

Kavi includes user-driven automation, tools, local code execution, WebView runtime surfaces, terminal/SSH workflows, skills, and local models. For App Review, explain these as productivity features executed inside the app's sandbox and under user control.

Reviewer notes should state:

- Kavi does not download or execute native iOS code.
- Skills/templates are user productivity content, not a third-party app marketplace.
- User-provided provider keys, SSH targets, MCP servers, and remote workspaces are optional.
- Sensitive actions require confirmation.
- The app can be fully reviewed without an account by using local mode and sample prompts.

If first-release confidence is the priority, consider hiding or disabling the highest-risk surfaces until they have clean reviewer notes and on-device evidence.

### Age Rating

Do not submit as a Kids app. Complete the age-rating questionnaire conservatively because Kavi can access the web, produce AI-generated text, work with user files, and execute user-directed automation.

## Google Play Checklist

### Metadata

- Package name: `com.kavi.mobile`.
- Version code: `1`.
- Target SDK: 36.
- Privacy policy URL: required.
- App access instructions: describe no-login review path and optional setup for AI providers.
- Content rating: complete conservatively for AI-generated content, web access, and user-directed automation.
- Data safety form: required.

### Target SDK

The current native configuration targets Android SDK 36, which is above Google Play's Android 15 / API 35 requirement for new apps and updates after 2025-08-31.

### AI-Generated Content

Google Play treats text chatbots as AI-generated-content apps. Before submission:

- Add in-app report/flagging for generated answers.
- Route reports to a support inbox or backend queue that the team monitors.
- Document the moderation process and expected response path.
- Add user-facing safety language in the privacy/support surface without turning the app into a marketing page.

### Data Safety

The Data safety form must reflect both local processing and user-directed sharing.

Likely data categories to review:

- User-generated text and files.
- Photos and videos.
- Audio.
- Contacts.
- Calendar data.
- Location.
- Device or app diagnostics if crash/analytics tooling is added later.

Likely sharing disclosures:

- User-configured AI providers.
- User-configured MCP servers.
- User-configured SSH/SFTP or browser targets.
- Operating-system share sheets and document pickers when invoked by the user.

Do not mark data as "not collected" merely because Kavi lacks a first-party server. Google considers app processing and transmission to third parties in the safety disclosure flow.

### Permissions

Current release manifest includes sensitive permissions for:

- Camera.
- Microphone.
- Contacts read/write.
- Calendar read/write.
- Fine/coarse location.
- Notifications.
- Photos/media image access.
- Foreground services.
- Boot completed and wake lock.
- Termux package visibility.

Before submission:

- Confirm each permission is core to a user-facing feature.
- Confirm runtime prompts happen only after user intent.
- Add or update Play Console declarations for restricted permissions, especially Photos and videos if `READ_MEDIA_IMAGES` remains.
- Consider whether write access to Contacts and Calendar is required for first release. Removing write permissions lowers review risk if read-only workflows are enough.
- Confirm notification lock-screen visibility stays private.

### Account Deletion

Kavi currently does not create first-party user accounts. If that remains true, do not claim account creation in Play Console. If account creation is added later, Play requires in-app account deletion and a web deletion resource.

## Release-Build Evidence

Current local checks:

| Check | Result | Notes |
| --- | --- | --- |
| `npm run verify` | Pass | Public hygiene, public language, links, licenses, metadata, i18n, maintainability, lint, typecheck, and Jest passed after this document was added. |
| `npm run check:app-metadata` | Pass | Native identifiers and metadata policy are consistent. |
| `npm run check:android:release-env` | Pass | Java 17, Android SDK, and Gradle wrapper were found. |
| `npm audit --omit=dev --audit-level=high` | Pass | No high or critical production advisories; moderate advisories remain and should be triaged. |
| `npm run check:public-hygiene` | Pass | Passed after this document was added. Re-run after every public-doc change. |
| `npm run check:links` | Pass | Passed after this document was added. Re-run after every public-doc change. |
| `npx expo-doctor` | Fail | 16/18 checks passed. Dependency version drift and SSH/SFTP New Architecture compatibility need resolution or explicit sign-off. |

Native configuration evidence:

- `app.json` sets Android compile/target SDK to 36.
- `android/app/build.gradle` fails release builds unless release signing is configured.
- Release Android manifests strip `SYSTEM_ALERT_WINDOW`, `READ_MEDIA_AUDIO`, `READ_MEDIA_VIDEO`, and legacy external-storage write permissions.
- `ios/Kavi/Info.plist` has no arbitrary network loads, no always-location usage string, no local-network usage string, and no Face ID usage string.
- `ios/Kavi/PrivacyInfo.xcprivacy` exists.
- Secure storage fails closed in release instead of falling back to plain AsyncStorage for secrets.
- Sensitive tools have approval and privacy-redaction layers.

## Final Gate Before Submission

Run these on the final release branch and save the outputs in the release notes or private submission packet:

```sh
npm ci
npm run verify
npm audit --omit=dev --audit-level=high
npx expo-doctor
npm run check:app-metadata
npm run check:public-hygiene
npm run check:links
npm run check:android:release-env
npm run build:android:aab
npm run build:ios:release-sim
```

Then perform manual smoke tests on clean installs:

- First launch and onboarding.
- Local chat without provider setup.
- Provider setup with a test key, then key removal.
- Permission denial and later enablement for camera, mic, photos, contacts, calendar, location, and notifications.
- Generated-answer reporting flow.
- Clear conversations.
- Clear memory.
- Remove integrations and secrets.
- Offline launch.
- Background/scheduler behavior.
- App upgrade from the previous build, if applicable.
- Android AAB installed through an internal test track.
- iOS archive installed through TestFlight.

## Reviewer Notes Draft

Use this as a starting point, then adjust it to match the final build:

> Kavi is an on-device AI productivity assistant. It can run with local features only, and no account is required for review. Users may optionally connect their own AI providers, MCP servers, SSH/SFTP targets, browser sessions, and local models. Kavi does not use advertising tracking. Sensitive actions such as accessing contacts, calendar, location, camera, microphone, files, remote hosts, or third-party providers require user intent and confirmation. The app stores provider keys and connection secrets in platform secure storage. Generated assistant answers include an in-app report option. Reviewers can test the app by completing onboarding, starting a local chat, and opening Settings to inspect privacy, support, and data controls.

## Store Asset Packet

Prepare these before opening store submissions:

- App icon and adaptive icon final review.
- iPhone screenshots for required sizes.
- iPad screenshots if iPad is supported.
- Android phone screenshots.
- Android tablet screenshots if tablets are supported.
- Short description.
- Full description.
- Keywords.
- Support URL.
- Privacy policy URL.
- App category.
- Age/content rating questionnaire answers.
- Data safety answers.
- App privacy answers.
- Export-compliance answer.
- Review notes.
- Demo/test provider key only if absolutely necessary; prefer a no-key local review path.

## Policy References

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files)
- [Apple required reason APIs](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api)
- [Google Play target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Google Play AI-generated content policy](https://support.google.com/googleplay/android-developer/answer/13985936)
- [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Google Play Data safety form](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Google Play photo and video permissions](https://support.google.com/googleplay/android-developer/answer/14115180)
- [Google Play user-generated content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
