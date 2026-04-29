const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const androidDir = path.join(projectRoot, 'android');
const isWindows = process.platform === 'win32';

function exists(targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function firstExisting(paths) {
  return paths.find((targetPath) => targetPath && exists(targetPath));
}

function resolveAndroidSdkRoot() {
  const envCandidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  const envHit = firstExisting(envCandidates);
  if (envHit) {
    return envHit;
  }

  const homeDir = os.homedir();
  const platformCandidates =
    process.platform === 'darwin'
      ? [path.join(homeDir, 'Library', 'Android', 'sdk')]
      : process.platform === 'win32'
        ? [path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')]
        : [path.join(homeDir, 'Android', 'Sdk')];

  return firstExisting(platformCandidates);
}

function resolveJavaHome() {
  const envCandidates = [
    process.env.JAVA_HOME,
    process.env.JAVA_HOME_17,
    process.env.JAVA_HOME_17_X64,
    process.env.JDK_HOME,
  ].filter(Boolean);

  const envHit = firstExisting(envCandidates);
  if (envHit) {
    return envHit;
  }

  if (process.platform === 'darwin' && exists('/usr/libexec/java_home')) {
    try {
      const detected = execFileSync('/usr/libexec/java_home', ['-v', '17'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (detected) {
        return detected;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function hasJavaOnPath() {
  const locator = isWindows ? 'where' : 'which';
  const executable = isWindows ? 'java.exe' : 'java';
  const result = spawnSync(locator, [executable], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
    shell: isWindows,
  });
  return result.status === 0;
}

function printEnvironmentSummary(summary) {
  console.log('[build-android-release] environment');
  console.log(`- project root: ${projectRoot}`);
  console.log(`- android dir: ${androidDir}`);
  console.log(`- java home: ${summary.javaHome || '[using java on PATH]'}`);
  console.log(
    `- android sdk: ${summary.androidSdkRoot || '[using Gradle/local.properties lookup]'}`,
  );
  console.log(`- gradle wrapper: ${summary.gradleWrapper}`);
}

function fail(message) {
  console.error(`[build-android-release] ${message}`);
  process.exitCode = 1;
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function exportArtifact({ buildBundle }) {
  const sourceArtifact = buildBundle
    ? path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
    : path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const artifactName = buildBundle ? 'kavi-release.aab' : 'kavi-release.apk';
  const exportedArtifact = path.join(projectRoot, 'release-artifacts', 'android', artifactName);

  if (!exists(sourceArtifact)) {
    fail(`Expected build artifact was not found at ${sourceArtifact}`);
    return false;
  }

  ensureDirectory(path.dirname(exportedArtifact));
  fs.copyFileSync(sourceArtifact, exportedArtifact);

  const stats = fs.statSync(exportedArtifact);
  console.log(`[build-android-release] exported artifact: ${exportedArtifact}`);
  console.log(`[build-android-release] size: ${stats.size} bytes`);
  return true;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const buildBundle = process.argv.includes('--bundle');
  const gradleWrapper = path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew');

  if (!exists(gradleWrapper)) {
    fail(`Missing Gradle wrapper at ${gradleWrapper}`);
    return;
  }

  const javaHome = resolveJavaHome();
  const androidSdkRoot = resolveAndroidSdkRoot();
  const problems = [];

  if (!javaHome && !hasJavaOnPath()) {
    problems.push('Java 17 was not found. Set JAVA_HOME or put a Java 17 runtime on PATH.');
  }

  if (!androidSdkRoot && !process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
    problems.push(
      'Android SDK was not found. Set ANDROID_HOME or ANDROID_SDK_ROOT, or install the SDK in the platform default location.',
    );
  }

  printEnvironmentSummary({ javaHome, androidSdkRoot, gradleWrapper });

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`[build-android-release] ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    console.log('[build-android-release] environment check passed');
    return;
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
  };

  if (javaHome) {
    env.JAVA_HOME = javaHome;
  }

  if (androidSdkRoot) {
    env.ANDROID_HOME = env.ANDROID_HOME || androidSdkRoot;
    env.ANDROID_SDK_ROOT = env.ANDROID_SDK_ROOT || androidSdkRoot;
  }

  const gradleTask = buildBundle ? 'bundleRelease' : 'assembleRelease';
  const result = spawnSync(gradleWrapper, [gradleTask], {
    cwd: androidDir,
    env,
    stdio: 'inherit',
    shell: isWindows,
  });

  if (typeof result.status === 'number') {
    if (result.status === 0) {
      process.exitCode = exportArtifact({ buildBundle }) ? 0 : 1;
      return;
    }

    process.exitCode = result.status;
    return;
  }

  if (result.error) {
    throw result.error;
  }

  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  fail(message);
}
