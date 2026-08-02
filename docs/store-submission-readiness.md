# Store Submission Readiness

Reviewed: 2026-07-29

Status: No-go for App Store or Play Store submission until the launch blockers below are closed and verified on release builds.

This document is the submission-prep checklist for Kavi. It is based on the current repository state, the native manifests, existing privacy/release docs, and current Apple and Google policy references.

## Executive Verdict

Kavi is technically close to a release candidate: native identifiers are consistent, Android targets SDK 36, release signing is guarded, sensitive tool use has confirmation gates, release storage fails closed instead of writing secrets to plain storage, and the existing privacy docs are strong.

The remaining risk is not basic app quality. The main submission risks are policy fit and launch packaging:

- Google Play requires in-app reporting or flagging for AI-generated content.
- Apple and Google require public privacy/support URLs and clear in-app privacy access.
- Android photo selection now uses the system picker without broad shared-library access; keep the merged-manifest guard green.
- Android long-running chat and sub-agent work uses a declared `specialUse` foreground
  service; the Play Console declaration, reviewer evidence, and physical-device matrix
  are still required.
- Dynamic code, skills, terminal, browser, local runtime, and downloadable model surfaces need a conservative reviewer story.
- SSH native-module compatibility and release-build smoke evidence must be resolved before submission.

## Launch Blockers

| ID  | Area                                                  | Required before submission                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | AI content reporting                                  | Add an in-app "Report" or "Flag" flow for assistant-generated content. It must let users report generated text without leaving the app, and the team needs a moderation/triage process for those reports.                                                                                                                                                                                                                                                                  | No user-facing report/flag action was found. Google Play's AI-generated content policy requires in-app reporting or flagging for AI-generated content.                                                                                                                                                                                                                                                                                                                                   |
| B2  | Privacy and support URLs                              | Publish the privacy policy and support/contact page, then expose them from Settings/About and store metadata.                                                                                                                                                                                                                                                                                                                                                              | `docs/privacy-policy.md` exists, but no public URL or in-app policy/support link was confirmed. Apple requires privacy policy access in metadata and in the app. Google Play requires a privacy policy link in the Data safety section.                                                                                                                                                                                                                                                  |
| B3  | Local data deletion clarity (resolved)                | Keep the exact, scoped deletion controls discoverable in-app and documented in the privacy policy.                                                                                                                                                                                                                                                                                                                                                                         | The Settings data card explains the independent conversation, memory, provider/integration, and service-key controls and links directly to Memory. Credential-backed configuration deletion is credential-first and retains the configuration on secure-cleanup failure so the user can retry. The privacy documents record the same paths without claiming a one-tap wipe. No first-party account exists, so account deletion rules are not triggered unless account creation is added. |
| B4  | Android photos/media permission (resolved)            | Keep photo selection on the system picker and prevent broad shared-library read permissions from returning.                                                                                                                                                                                                                                                                                                                                                                | Chat attachments and the agentic `photos_pick` tool use `expo-image-picker`. `expo-media-library` is not a runtime dependency, and the Android manifest removes `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED`, and `READ_EXTERNAL_STORAGE`.                                                                                                                                                                                                                                     |
| B5  | Dynamic execution and downloadable capability posture | Prepare reviewer notes and, if needed, limit first-release exposure of ClawHub skills, dynamic JavaScript/Python, terminal, and browser automation. Do not position the feature set as a plugin/app marketplace. Bundle release runtime assets instead of depending on CDN code at runtime where practical.                                                                                                                                                                | The editor and terminal JavaScript runtimes are built from pinned npm dependencies and bundled into identical platform assets, with regressions prohibiting runtime CDN loaders. Pyodide runtime delivery, ClawHub/skills, browser automation, local models, and the final reviewer posture remain unresolved.                                                                                                                                                                           |
| B6  | Expo dependency health                                | Resolve or explicitly document the `expo-doctor` failure before release. Prefer a clean `expo-doctor` for submission builds.                                                                                                                                                                                                                                                                                                                                               | `npx expo-doctor` reports 17/18 passing. The only failed check is React Native Directory metadata: `@dylankenneally/react-native-ssh-sftp` is not validated for the New Architecture, and the first-party local `@kavi/kavi-ssh` package has no directory metadata.                                                                                                                                                                                                                      |
| B7  | Store assets and exact-build proof                    | Create final screenshots, listing copy, age/content ratings, export-compliance answers, and reviewer notes. Build the exact AAB/IPA/archive that will be submitted and smoke-test it on real devices.                                                                                                                                                                                                                                                                      | Fresh local release evidence exists: a validation-signed Android Release APK completed clean-install Agent, Chitchat, restart-persistence, and offline-terminal flows; an arm64 iOS Release simulator app built, installed, launched, and rendered onboarding. This is not distribution proof: no store-signed AAB/archive, internal-track/TestFlight install, physical-device portfolio, or final asset packet exists.                                                                  |
| B8  | Android long-running foreground-service declaration   | Declare the `specialUse` foreground-service type in Play Console. Provide the feature description, why interruption or deferral harms the user, a demo video showing user initiation and the ongoing notification with **Stop tasks**, and evidence that the service stops at task completion. Validate the exact release on physical devices, including notification denial, Doze, battery saver, reboot, force-stop/manual recovery, network loss, and provider timeout. | The manifest, native lease coordinator, notification, Stop action, and deterministic lifecycle tests are present. The service is generic to active chat/sub-agent lifetimes and does not route on prompts or benchmark cases. Play review/approval and a physical-device lifecycle matrix have not been completed, so background-reliability and store-readiness claims remain blocked.                                                                                                  |

B3 and B4 are closed. Their identifiers remain in the table for audit continuity. Store
submission remains a no-go while B1, B2, and B5–B8 are unresolved.

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
- User-mediated image selection through the system photo picker; no broad shared-library read permission.
- Foreground services.
- Boot completed and wake lock.
- Termux package visibility.

Before submission:

- Confirm each permission is core to a user-facing feature.
- Confirm runtime prompts happen only after user intent.
- Confirm the merged release manifest continues to omit broad photo/storage read permissions.
- Consider whether write access to Contacts and Calendar is required for first release. Removing write permissions lowers review risk if read-only workflows are enough.
- Confirm notification lock-screen visibility stays private.

### Long-running assistant work

Kavi owns active, user-started chat and sub-agent work with a `specialUse`
foreground service only after the activity leaves the foreground. Its ongoing
notification identifies the work, reports the active task count, opens the app, and
offers a **Stop tasks** action. The service is reference-counted across generic task
lifetimes and stops after the last task. It is not selected by prompt text, benchmark
identity, target duration, or expected output.

The same service owns a React Native Headless JS scheduler task and a bounded,
periodically renewed partial wake lock while native leases remain active. The
headless task waits only for the native all-leases-idle signal; it does not inspect,
route, repeat, or score assistant work. Persisted recovery remains authoritative if
Android terminates the process.

Before Play submission:

- Complete the foreground-service declaration for `specialUse` in Play Console and
  use the same explanation as the shipped manifest.
- Describe the user benefit, why deferral or interruption breaks the workflow, and
  why another foreground-service type does not fit.
- Attach a demo video showing the user starting work in Chat, backgrounding Kavi,
  seeing the ongoing notification, using **Stop tasks**, and observing termination.
- Verify that users can stop the work, that the service runs only while work is
  active, and that no service starts from an unrelated background event.
- Record exact-build physical-device evidence for normal completion, interruption,
  process death, force-stop/manual relaunch, reboot, Doze/app standby, battery saver,
  notification denial, provider timeout, and network loss.

Google documents `specialUse` as the type for valid foreground-service cases not
covered by another type, with a manifest subtype explanation and Play review. The
Play declaration asks for the feature description, interruption impact, demo video,
and use case. See the official
[service-type requirements](https://developer.android.com/develop/background-work/services/fgs/service-types),
[foreground-service policy](https://support.google.com/googleplay/android-developer/answer/17105854),
and [Play Console declaration guidance](https://support.google.com/googleplay/android-developer/answer/13392821).

### Account Deletion

Kavi currently does not create first-party user accounts. If that remains true, do not claim account creation in Play Console. If account creation is added later, Play requires in-app account deletion and a web deletion resource.

## Release-Build Evidence

Current evidence combines the 2026-07-22 signed release-build/device baseline with
the 2026-08-02 source, dependency, native-unit, and evaluation refresh. Historical
device rows are labeled explicitly and are not exact-build proof for the current tree:

| Check                                  | Result                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                       | Pass                         | Public hygiene/language, links, 1,033 dependency-license entries, evaluation contracts, metadata, dependency alignment, nine locales, architecture, maintainability, lint, TypeScript, and 1,225 suites / 10,703 tests passed; 16 opt-in suites / 88 tests were skipped.                                                                                                                                                                                                                                                                                   |
| `npm run test:coverage`                | Prior baseline pass          | Existing thresholds passed without reduction: 86.50% statements, 77.00% branches, 91.55% functions, and 87.72% lines. Rerun coverage before changing the published thresholds or making a current-tree coverage claim.                                                                                                                                                                                                                                                                                                                                     |
| `npm run eval:memory`                  | Pass                         | The deterministic memory slice passed 1 suite / 4 tests covering grounded correction, interdependent multi-turn recall, passive ingestion, and goal-scoped task-stack recall.                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run eval:agent`                   | Pass                         | The secondary deterministic acceptance slice passed 7 suites / 13 tests. It does not replace native release-flow evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run eval:long-tasks`              | Pass                         | The keyless structural durability gate passed 41 suites / 294 tests across interrupted foreground replies, scheduler persistence, provider-valid restart recovery, adaptive horizons, compaction continuity, Android foreground-service leases, native recovery bridges, terminal reporting, and duplicate-effect prevention. Physical-device lifecycle evidence is still required.                                                                                                                                                                        |
| `npm run eval:long-tasks:wall-clock`   | Prior local pass             | OpenRouter completed one worker with 15 identical sequential one-minute waits in 1,007,443 ms, then continued from persisted chat context and verified exactly one artifact write/read. This proves in-process wall-clock continuity, not mobile-OS execution after suspension or process death.                                                                                                                                                                                                                                                           |
| `npm run check:android:release-env`    | Pass                         | Java 17, Android SDK, and the Gradle wrapper were found.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Android Release native unit tests      | Pass                         | `:app:testReleaseUnitTest` completed with maintainer-local validation signing. The coordinator, lease registry, cancellation, recreation, and wake-lock/service contracts passed without starting an emulator.                                                                                                                                                                                                                                                                                                                                             |
| `npm run build:android:release`        | Pass (current local tree)    | A minified arm64 Release APK built with temporary local validation signing, passed signature/package inspection and exact-value scans for the configured provider key and local model, and its repository-debug-resigned copy update-installed on the dedicated emulator. It is not a store upload artifact.                                                                                                                                                                                                                                               |
| Current Android long-horizon Chat      | Infrastructure-invalid       | The current APK cold-launched, but a second emulator on the resource-constrained host caused Android System UI/WindowManager ANRs and package-service restarts before a trustworthy Chat trial could run. No product pass or failure is claimed; rerun on an idle one-emulator host and complete the physical-device matrix.                                                                                                                                                                                                                               |
| iOS durable-execution core             | Pass                         | The Swift package compiled and passed 36 tests covering exact-attempt identity, persistence, retries, expiration, relaunch, cancellation, scheduling, and SQLite concurrency.                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run build:ios:release-sim`        | Prior pass; current blocked  | The historical arm64 Release simulator artifact installed and launched. The 2026-08-02 current-tree attempt completed pods and codegen but Xcode rejected every destination before compilation because the installed 26.3 runtime did not match the selected 26.5 platform SDK. Align the toolchain and rerun; the historical artifact is not current exact-build proof.                                                                                                                                                                                   |
| Exact Android Release chat             | Prior baseline pass          | The 2026-07-22 OpenRouter onboarding and Chat flows used the public UI, completed an agent request and a direct response, and survived a cold relaunch. This is retained as historical integration evidence only.                                                                                                                                                                                                                                                                                                                                          |
| Exact Android Release offline terminal | Prior baseline pass          | With emulator network interfaces disabled and no route present, the ordinary bundled JavaScript terminal rendered and evaluated `2*2` as `4`. This is retained as historical integration evidence only.                                                                                                                                                                                                                                                                                                                                                    |
| Production and full dependency audits  | Pass high / moderate signoff | Both `--audit-level=high` gates pass with no high or critical findings. The lockfile selects patched `brace-expansion@1.1.18` for legacy callers. The production audit reports 10 moderate findings and the full audit reports 11, all expanded from Expo/Jest build-time `xcode -> uuid@7.0.3`; the affected package is not bundled into the app runtime. npm's proposed forced remediation downgrades Expo and is not acceptable. Keep the reachability disposition in `docs/release.md` under review until an SDK-compatible upstream fix is available. |
| `npx expo-doctor`                      | Needs signoff                | 17/18 checks passed. The only failure is React Native Directory metadata: the SSH/SFTP package is untested on the New Architecture and the first-party local SSH package has no directory metadata.                                                                                                                                                                                                                                                                                                                                                        |

Native configuration evidence:

- `app.json` sets Android compile/target SDK to 36.
- `android/app/build.gradle` fails release builds unless release signing is configured.
- Active Android chat and sub-agent execution starts a user-visible `specialUse`
  foreground service when the activity backgrounds and retains it only until the final
  task lease ends; persisted recovery remains authoritative after process death.
- Release Android manifests strip `SYSTEM_ALERT_WINDOW`, `READ_MEDIA_AUDIO`, `READ_MEDIA_VIDEO`, and legacy external-storage write permissions.
- Release Android manifests also strip `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED`, and `READ_EXTERNAL_STORAGE`; photo selection uses the system picker.
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

> Kavi is an on-device AI productivity assistant. It can run with local features only, and no account is required for review. Users may optionally connect their own AI providers, MCP servers, SSH/SFTP targets, browser sessions, and local models. Kavi does not use advertising tracking. Sensitive actions such as accessing contacts, calendar, location, camera, microphone, files, remote hosts, or third-party providers require user intent and confirmation. The app stores provider keys and connection secrets in platform secure storage. Reviewers can test the app by completing onboarding, starting a local chat, and opening Settings to inspect privacy and data controls. Add the verified report, privacy-policy, and support paths here only after B1 and B2 are closed in the submitted build.

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
- [Android foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Android foreground-service launch guidance](https://developer.android.com/develop/background-work/services/fgs/launch)
- [Android background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Google Play foreground-service policy](https://support.google.com/googleplay/android-developer/answer/17105854)
- [Google Play foreground-service declaration guidance](https://support.google.com/googleplay/android-developer/answer/13392821)
