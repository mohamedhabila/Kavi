# Android Long-Horizon Testing

This guide validates long-running Android assistant work from the ordinary Chat entry
point. It covers native background ownership, a real OpenRouter run, cancellation,
and persisted recovery. It is an integration and product-reliability procedure, not
an official benchmark protocol.

## Execution Contract

Android chat turns and sub-agents use one generic execution lease. The app does not
inspect prompts, benchmark names, task duration, or expected answers. While the
activity is visible, the lease is silent. If the user switches away while work is
active, Kavi promotes the process to a `specialUse` foreground service with an
ongoing notification and a **Stop tasks** action. The service ends when the final
lease ends. Stop cancels every active foreground chat and running sub-agent instead
of merely hiding the notification.

The durability mechanisms have distinct responsibilities:

- The foreground service keeps live, user-started chat and sub-agent execution
  user-visible and process-prioritized while the app is backgrounded.
- The service owns one React Native Headless JS task for the same native lease
  lifetime. The task does not repeat or interpret agent work; it waits only for the
  native all-leases-idle signal so React Native keeps network and timer scheduling
  active after the activity pauses.
- A non-reference-counted partial wake lock keeps the CPU available while that
  service owns active work. Each acquisition has a six-hour safety timeout and a
  native Android handler renews it after five hours while leases remain active. The
  lock and renewal are removed on every service stop path.
- WorkManager reconciles exact, finite external-operation handles; it is not an
  unbounded JavaScript execution loop.
- Persisted checkpoints and startup recovery are authoritative after process death.
  Android force-stop suppresses automatic app work until the user launches Kavi
  again, so a force-stop trial passes only if manual relaunch recovers truthfully.

## Resource-Isolated Build and Install

Keep the emulator shut down during the release build on resource-constrained hosts.
After the artifact is complete, stop Gradle before starting one emulator:

```bash
npm run check:android:release-env
npm run build:android:release
cd android && ./gradlew --stop && cd ..
emulator -avd Kavi_API_36 -no-snapshot-save -no-boot-anim
adb wait-for-device
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Run exactly one mobile simulator or emulator on a constrained host. Wait for Android's
`sys.boot_completed=1` signal and confirm the package, activity, and window services
answer before installing. A System UI/WindowManager ANR, a `system_server` or package-
manager restart, or a non-responsive UI hierarchy makes the trial infrastructure-
invalid; preserve it as a failure artifact, but do not score it as an app pass or fail.

Use the exact artifact intended for the trial. Record its SHA-256 digest, package
identifier, version, signing identity, emulator/device build, model identifier, start
and finish times, and result under ignored `.private/evals/` storage. Never copy a
provider key into logs, command transcripts, screenshots, or evidence artifacts.

## Chat-to-Background OpenRouter Trial

Complete these steps through the normal product UI:

1. Configure the selected OpenRouter model in Settings.
2. In Chat, start a generic task that delegates at least 15 minutes of sequential,
   verifiable work and returns control to the main conversation. Use a novel task and
   outcome-based evidence; do not add any corresponding production special case.
3. Wait until Chat reports that the worker is running, then press Home and turn the
   screen off. Confirm the truthful ongoing notification and inspect the native
   service and scoped wake lock with:

   ```bash
   adb shell dumpsys activity services com.kavi.mobile
   adb shell dumpsys power
   ```

   The service must be foreground and `dumpsys power` must show the
   `com.kavi.mobile:long-horizon-execution` partial wake lock while work is active.

4. For the entire interval, sample the app PID, service presence, wake lock,
   notification, device time, persisted conversation, and execution journal without
   waking the display or reopening Kavi. Require model/tool checkpoints and output
   files to advance while the screen remains off. A resident process with a static
   journal is a failed live-continuity trial even when the service and wake lock are
   present.
5. Relaunch Kavi, retrieve the result through Chat, and verify the expected artifact
   or other terminal evidence exactly once. Confirm the service and notification end
   after all active work finishes.

Classify transport, DNS, or provider-admission failures separately as infrastructure-
invalid evidence. Do not retry a product failure into a pass or relax the task after
seeing the outcome.

## Stop and Recovery Trials

Run cancellation and recovery as separate trials:

1. Start a short worker, background Kavi, use **Stop tasks**, and verify that the
   notification, foreground service, partial wake lock, foreground chat, and running
   sub-agents stop.
2. Start checkpointed work, force-stop Kavi, and verify that no progress is claimed
   during the force-stop interval. Manually relaunch, then confirm persisted recovery
   reaches a truthful terminal state without duplicate effects.
3. Kill the process without force-stop and record whether scheduled/native recovery
   wakes. Distinguish a resumed operation from reconciliation of an already-started
   external handle.

## Release Evidence Matrix

An emulator validates integration, notification ownership, and the ordinary Chat
entry point. Release claims also require exact-build physical-device evidence across:

- supported Android versions and representative OEM process management;
- screen-off, Doze/app standby, and battery saver;
- notification granted and denied;
- network loss/recovery and provider timeout;
- process death, force-stop/manual relaunch, reboot, and app upgrade;
- normal completion, user cancellation, and concurrent chat/sub-agent leases; and
- a Play-distributed, release-signed build.

For each trial, preserve timestamps and terminal evidence, including failures. Do not
claim that a foreground service guarantees survival after process death, or that an
emulator substitutes for the physical-device matrix.

## Platform and Play Requirements

Android limits foreground-service starts from the background. Kavi starts this
service while its activity is transitioning from a user-visible state and declares
the `specialUse` type and permission. Google Play requires the type to be core and
user-beneficial, initiated or perceptible to the user, stoppable, and limited to the
necessary duration. The Play Console declaration needs a feature description,
interruption impact, demo video, and use case.

Official references:

- [Android foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Android foreground-service launch guidance](https://developer.android.com/develop/background-work/services/fgs/launch)
- [Android background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Android wake-lock guidance](https://developer.android.com/develop/background-work/background-tasks/awake/wakelock)
- [Android wake-lock best practices](https://developer.android.com/develop/background-work/background-tasks/awake/wakelock/best-practices)
- [Android long-running WorkManager workers](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running)
- [React Native Headless JS](https://reactnative.dev/docs/headless-js-android)
- [Google Play foreground-service policy](https://support.google.com/googleplay/android-developer/answer/17105854)
- [Google Play foreground-service declaration guidance](https://support.google.com/googleplay/android-developer/answer/13392821)
