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

## Start Development

```bash
npm start
```

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

If Android SDK variables are not set, the release wrapper also checks the conventional platform defaults:

- macOS: `~/Library/Android/sdk`
- Linux: `~/Android/Sdk`
- Windows: `%LOCALAPPDATA%/Android/Sdk`

On macOS, if `JAVA_HOME` is not set, the release wrapper also tries `/usr/libexec/java_home -v 17`.

## Android Release Build

Check the release environment without starting a build:

```bash
npm run check:android:release-env
```

Build the Android release artifact:

```bash
npm run build:android:release
```

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

## Public Repository Hygiene

- `_research/` is intentionally private working material and should not be carried into a public git history.
- Build output, local caches, and editor-generated artifacts outside the committed runtime files should remain untracked.
- Use `THIRD_PARTY_PROVENANCE.md` when changing patched or historically carried-forward code.

Before creating or validating a public branch, run:

```bash
npm run check:public-hygiene
```

The check skips when this workspace is not inside a git repository and becomes an enforcement guard once the public repository is created.
