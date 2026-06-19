# Development Setup

This guide covers the baseline local setup for contributing to Kavi.

## Toolchain

- Node.js 22 LTS is the pinned baseline. The repository includes `.nvmrc` with `22`.
- npm 10 or newer is recommended.
- Java 17 is required for Android release builds.
- Android Studio and the Android SDK are required for Android device and emulator work.
- Current Xcode plus CocoaPods are required for iOS development on macOS.

## Node Version

If you use `nvm`:

```bash
nvm use
```

The repository `engines` field currently allows newer runtimes for local compatibility, but CI and docs are pinned to Node 22.

## Install Dependencies

```bash
npm install
```

The install step also:

- applies `patch-package`
- rebuilds the generated editor assets used by the in-app editor

To reproduce the clean dependency install used by GitHub Actions, start from a
clean checkout and run:

```bash
npm ci
```

## Start Development

```bash
npm start
```

## Local Environment Overrides

The app does not require private backend defaults for local development.
Optional machine-specific values belong in `.env.local`, copied from
`.env.local.example` when needed.

- Do not commit real `.env.local` files or private infrastructure endpoints.
- Use `.env.local.example` as the template for opt-in E2E provider keys; do not
  paste real keys into docs, issues, pull requests, or test fixtures.
- Leave `EXPO_PUBLIC_CLAWHUB_CONVEX_URL` unset unless ClawHub browse discovery
  is unavailable or you are testing against a compatible local endpoint.
- Keep MCP and Expo/EAS integration files in the repository; they are public
  runtime compatibility surfaces, not private cleanup material.

## App Identity And Versioning

The public source package version, Expo app version, iOS marketing version,
Android `versionName`, and MCP client metadata are kept on the same semantic
version. For this release line that version is `1.0.0`.

The native app identifiers are intentionally platform-specific:

- iOS bundle identifier: `com.kavi.app`
- Android namespace and application ID: `com.kavi.mobile`

Do not rename either native identifier as part of routine cleanup. Changing
them creates different installed apps and can affect signing, updates, deep
links, and local app storage. If a future release needs to change an identifier,
update the native project files, Expo config, app metadata guard, and migration
notes together.

## Run The App

Android:

```bash
npm run android
```

iOS:

```bash
npm run ios
```

## Android SDK Expectations

The Android release wrapper now prefers environment-driven configuration.

Recognized variables:

- `ANDROID_HOME`
- `ANDROID_SDK_ROOT`
- `JAVA_HOME`
- `JAVA_HOME_17`
- `JAVA_HOME_17_X64`
- `JDK_HOME`

If Android SDK variables are not set, the release wrapper also checks the conventional platform defaults:

- macOS: `~/Library/Android/sdk`
- Linux: `~/Android/Sdk`
- Windows: `%LOCALAPPDATA%/Android/Sdk`

On macOS, if `JAVA_HOME` is not set, the release wrapper also tries `/usr/libexec/java_home -v 17`.

Do not add machine-specific Java paths to `android/gradle.properties`. If
Gradle itself needs an explicit Java runtime outside the release wrapper, set
`JAVA_HOME` in your shell or put `org.gradle.java.home` in your user-local
`~/.gradle/gradle.properties`.

## Android Release Checks And Signing

The public-safe Android release check verifies local Java and Android SDK
discovery without requiring maintainer signing material:

```bash
npm run check:android:release-env
```

Maintainer release builds also need signing configuration. Keep signing
material outside git by using a local `android/keystore.properties` file or the
environment variables expected by `android/app/build.gradle`:

- `KAVI_UPLOAD_STORE_FILE`
- `KAVI_UPLOAD_STORE_PASSWORD`
- `KAVI_UPLOAD_KEY_ALIAS`
- `KAVI_UPLOAD_KEY_PASSWORD`

Build a signed Android release artifact only after the public-safe check passes
and signing is configured on the maintainer machine:

```bash
npm run build:android:release
```

Build an Android App Bundle for store submission:

```bash
npm run build:android:aab
```

Generated release artifacts are written under `release-artifacts/`, which is
gitignored and must not be committed.

## iOS Native Setup

After changing iOS native dependencies:

```bash
cd ios && pod install
```

To build the iOS simulator release target used by local packaging checks:

```bash
npm run build:ios:release-sim
```

## Generated Assets

Kavi commits generated editor assets because the native app depends on them at runtime.

If you touch the editor runtime or template files, regenerate the bundle:

```bash
npm run build:editor-assets
```

`npm install`, `npm run android`, `npm run ios`, and release build scripts run
the same asset build automatically before starting their native work. Commit
the generated runtime files that belong to the editor bundle; keep local build
caches and release outputs untracked.

## Public Repository Hygiene

- Maintainer-private working material should not be carried into public git history.
- Build output, local caches, and editor-generated artifacts outside the committed runtime files should remain untracked.
- Use `THIRD_PARTY_PROVENANCE.md` when changing patched or historically carried-forward code.

Before creating or validating a public branch, run:

```bash
npm run check:public-hygiene
```

The check skips when this workspace is not inside a git repository and becomes an enforcement guard once the public repository is created.
