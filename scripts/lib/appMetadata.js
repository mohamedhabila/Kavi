const fs = require('fs');
const path = require('path');

const EXPECTED_APP_METADATA = {
  displayName: 'Kavi',
  slug: 'kavi',
  packageName: 'kavi',
  iosBundleIdentifier: 'com.kavi.app',
  androidApplicationId: 'com.kavi.mobile',
};

function readText(projectRoot, relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function readJson(projectRoot, relativePath) {
  return JSON.parse(readText(projectRoot, relativePath));
}

function matchString(content, regex) {
  const match = content.match(regex);
  return match?.[1]?.trim() ?? null;
}

function matchAllStrings(content, regex) {
  return Array.from(content.matchAll(regex), (match) => match[1].trim());
}

function unique(values) {
  return Array.from(new Set(values));
}

function plistStringValue(content, key) {
  return matchString(content, new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`, 'm'));
}

function plistStringArrayValue(content, key) {
  const arrayContent = matchString(
    content,
    new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`, 'm'),
  );
  if (!arrayContent) return [];
  return matchAllStrings(arrayContent, /<string>([^<]+)<\/string>/g);
}

function tsStringExport(content, exportName) {
  return matchString(
    content,
    new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*['"]([^'"]+)['"]\\s*;`, 'm'),
  );
}

function parseAndroidGradle(content) {
  return {
    namespace: matchString(content, /\bnamespace\s+['"]([^'"]+)['"]/),
    applicationId: matchString(content, /\bapplicationId\s+['"]([^'"]+)['"]/),
    versionCode: matchString(content, /\bversionCode\s+([0-9]+)/),
    versionName: matchString(content, /\bversionName\s+['"]([^'"]+)['"]/),
  };
}

function parseXcodeProject(content) {
  return {
    currentProjectVersions: unique(
      matchAllStrings(content, /\bCURRENT_PROJECT_VERSION\s*=\s*([^;]+);/g),
    ),
    marketingVersions: unique(matchAllStrings(content, /\bMARKETING_VERSION\s*=\s*([^;]+);/g)),
    productBundleIdentifiers: unique(
      matchAllStrings(content, /\bPRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g),
    ),
  };
}

function collectAppMetadata(projectRoot = path.resolve(__dirname, '../..')) {
  const packageJson = readJson(projectRoot, 'package.json');
  const packageLock = readJson(projectRoot, 'package-lock.json');
  const appJson = readJson(projectRoot, 'app.json');
  const androidGradle = parseAndroidGradle(readText(projectRoot, 'android/app/build.gradle'));
  const iosInfoPlist = readText(projectRoot, 'ios/Kavi/Info.plist');
  const xcodeProject = parseXcodeProject(
    readText(projectRoot, 'ios/Kavi.xcodeproj/project.pbxproj'),
  );
  const appMetadataSource = readText(projectRoot, 'src/constants/appMetadata.ts');
  const changelog = readText(projectRoot, 'CHANGELOG.md');

  return {
    packageJson: {
      name: packageJson.name,
      version: packageJson.version,
    },
    packageLock: {
      name: packageLock.name,
      version: packageLock.version,
      rootPackageVersion: packageLock.packages?.['']?.version ?? null,
    },
    expo: {
      name: appJson.expo?.name ?? null,
      slug: appJson.expo?.slug ?? null,
      version: appJson.expo?.version ?? null,
      plugins: appJson.expo?.plugins ?? [],
      iosBundleIdentifier: appJson.expo?.ios?.bundleIdentifier ?? null,
      iosBuildNumber: appJson.expo?.ios?.buildNumber ?? null,
      androidPackage: appJson.expo?.android?.package ?? null,
      androidVersionCode: appJson.expo?.android?.versionCode ?? null,
    },
    android: androidGradle,
    ios: {
      bundleIdentifier: plistStringValue(iosInfoPlist, 'CFBundleIdentifier'),
      shortVersionString: plistStringValue(iosInfoPlist, 'CFBundleShortVersionString'),
      bundleVersion: plistStringValue(iosInfoPlist, 'CFBundleVersion'),
      backgroundModes: plistStringArrayValue(iosInfoPlist, 'UIBackgroundModes'),
      backgroundTaskIdentifiers: plistStringArrayValue(
        iosInfoPlist,
        'BGTaskSchedulerPermittedIdentifiers',
      ),
      xcodeProject,
    },
    runtime: {
      displayName: tsStringExport(appMetadataSource, 'APP_DISPLAY_NAME'),
      version: tsStringExport(appMetadataSource, 'APP_VERSION'),
    },
    changelog: {
      latestVersion: matchString(changelog, /^## \[([^\]]+)\]/m),
    },
  };
}

function addMismatch(failures, label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function addAllMismatch(failures, label, actualValues, expected) {
  const values = unique(actualValues);
  if (values.length !== 1 || values[0] !== expected) {
    failures.push(
      `${label} are ${JSON.stringify(values)}, expected only ${JSON.stringify(expected)}`,
    );
  }
}

function findAppMetadataFailures(metadata, expected = EXPECTED_APP_METADATA) {
  const failures = [];
  const sourceVersion = metadata.packageJson.version;
  const iosBuildNumber = String(metadata.expo.iosBuildNumber ?? '');
  const androidVersionCode = String(metadata.expo.androidVersionCode ?? '');
  const expoPlugins = new Set(
    (metadata.expo.plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin)),
  );

  addMismatch(failures, 'package.json name', metadata.packageJson.name, expected.packageName);
  addMismatch(failures, 'package-lock.json name', metadata.packageLock.name, expected.packageName);
  addMismatch(failures, 'package-lock.json version', metadata.packageLock.version, sourceVersion);
  addMismatch(
    failures,
    'package-lock root package version',
    metadata.packageLock.rootPackageVersion,
    sourceVersion,
  );

  addMismatch(failures, 'Expo app name', metadata.expo.name, expected.displayName);
  addMismatch(failures, 'Expo slug', metadata.expo.slug, expected.slug);
  addMismatch(failures, 'Expo version', metadata.expo.version, sourceVersion);

  addMismatch(
    failures,
    'Expo iOS bundle identifier',
    metadata.expo.iosBundleIdentifier,
    expected.iosBundleIdentifier,
  );
  addMismatch(
    failures,
    'Xcode product bundle identifiers',
    metadata.ios.xcodeProject.productBundleIdentifiers.join(','),
    expected.iosBundleIdentifier,
  );
  addMismatch(
    failures,
    'iOS CFBundleIdentifier',
    metadata.ios.bundleIdentifier,
    '$(PRODUCT_BUNDLE_IDENTIFIER)',
  );

  addMismatch(
    failures,
    'Expo Android package',
    metadata.expo.androidPackage,
    expected.androidApplicationId,
  );
  addMismatch(
    failures,
    'Android namespace',
    metadata.android.namespace,
    expected.androidApplicationId,
  );
  addMismatch(
    failures,
    'Android applicationId',
    metadata.android.applicationId,
    expected.androidApplicationId,
  );

  if (expected.iosBundleIdentifier === expected.androidApplicationId) {
    failures.push('expected app metadata must keep platform-specific identifiers explicit');
  }

  addMismatch(
    failures,
    'iOS CFBundleShortVersionString',
    metadata.ios.shortVersionString,
    sourceVersion,
  );
  addAllMismatch(
    failures,
    'Xcode MARKETING_VERSION values',
    metadata.ios.xcodeProject.marketingVersions,
    sourceVersion,
  );
  addMismatch(failures, 'Android versionName', metadata.android.versionName, sourceVersion);
  addMismatch(failures, 'runtime APP_VERSION', metadata.runtime.version, sourceVersion);
  addMismatch(
    failures,
    'runtime APP_DISPLAY_NAME',
    metadata.runtime.displayName,
    expected.displayName,
  );
  addMismatch(
    failures,
    'latest changelog version',
    metadata.changelog.latestVersion,
    sourceVersion,
  );

  addMismatch(failures, 'iOS CFBundleVersion', metadata.ios.bundleVersion, iosBuildNumber);
  addAllMismatch(
    failures,
    'Xcode CURRENT_PROJECT_VERSION values',
    metadata.ios.xcodeProject.currentProjectVersions,
    iosBuildNumber,
  );
  addMismatch(failures, 'Android versionCode', metadata.android.versionCode, androidVersionCode);

  if (!expoPlugins.has('expo-background-task')) {
    failures.push('Expo plugins must include "expo-background-task" for scheduled background work');
  }
  if (!metadata.ios.backgroundModes.includes('processing')) {
    failures.push('iOS UIBackgroundModes must include "processing" for scheduled background work');
  }
  if (
    !metadata.ios.backgroundTaskIdentifiers.includes('com.expo.modules.backgroundtask.processing')
  ) {
    failures.push(
      'iOS BGTaskSchedulerPermittedIdentifiers must include "com.expo.modules.backgroundtask.processing"',
    );
  }

  return failures;
}

function runAppMetadataCli(projectRoot = path.resolve(__dirname, '../..')) {
  const metadata = collectAppMetadata(projectRoot);
  const failures = findAppMetadataFailures(metadata);

  if (failures.length > 0) {
    failures.forEach((failure) => {
      console.error(`[check-app-metadata] ${failure}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log(
    '[check-app-metadata] App version and native identifiers match the public metadata policy.',
  );
}

module.exports = {
  EXPECTED_APP_METADATA,
  collectAppMetadata,
  findAppMetadataFailures,
  parseAndroidGradle,
  plistStringArrayValue,
  parseXcodeProject,
  runAppMetadataCli,
};
