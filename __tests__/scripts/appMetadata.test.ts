const { mkdtempSync, mkdirSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { dirname, join } = require('path');

const {
  collectAppMetadata,
  findAppMetadataFailures,
  parseAndroidGradle,
  parseXcodeProject,
} = require('../../scripts/lib/appMetadata');

function writeFixture(projectRoot: string, relativePath: string, content: string): void {
  const target = join(projectRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function createMetadataFixture(overrides: Record<string, string> = {}): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'kavi-app-metadata-'));
  const version = overrides.version || '1.0.0';
  const expoVersion = overrides.expoVersion || version;
  const iosBundleIdentifier = overrides.iosBundleIdentifier || 'com.kavi.app';
  const androidApplicationId = overrides.androidApplicationId || 'com.kavi.mobile';

  writeFixture(
    projectRoot,
    'package.json',
    JSON.stringify({ name: 'kavi', version }, null, 2),
  );
  writeFixture(
    projectRoot,
    'package-lock.json',
    JSON.stringify(
      { name: 'kavi', version, packages: { '': { name: 'kavi', version } } },
      null,
      2,
    ),
  );
  writeFixture(
    projectRoot,
    'app.json',
    JSON.stringify(
      {
        expo: {
          name: 'Kavi',
          slug: 'kavi',
          version: expoVersion,
          ios: { bundleIdentifier: iosBundleIdentifier, buildNumber: '1' },
          android: { package: androidApplicationId, versionCode: 1 },
        },
      },
      null,
      2,
    ),
  );
  writeFixture(
    projectRoot,
    'android/app/build.gradle',
    [
      'android {',
      `    namespace '${androidApplicationId}'`,
      '    defaultConfig {',
      `        applicationId '${androidApplicationId}'`,
      '        versionCode 1',
      `        versionName "${expoVersion}"`,
      '    }',
      '}',
    ].join('\n'),
  );
  writeFixture(
    projectRoot,
    'ios/Kavi/Info.plist',
    [
      '<plist version="1.0"><dict>',
      '<key>CFBundleIdentifier</key>',
      '<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>',
      '<key>CFBundleShortVersionString</key>',
      `<string>${expoVersion}</string>`,
      '<key>CFBundleVersion</key>',
      '<string>1</string>',
      '</dict></plist>',
    ].join('\n'),
  );
  writeFixture(
    projectRoot,
    'ios/Kavi.xcodeproj/project.pbxproj',
    [
      'CURRENT_PROJECT_VERSION = 1;',
      `MARKETING_VERSION = ${expoVersion};`,
      `PRODUCT_BUNDLE_IDENTIFIER = ${iosBundleIdentifier};`,
      'CURRENT_PROJECT_VERSION = 1;',
      `MARKETING_VERSION = ${expoVersion};`,
      `PRODUCT_BUNDLE_IDENTIFIER = ${iosBundleIdentifier};`,
    ].join('\n'),
  );
  writeFixture(
    projectRoot,
    'src/constants/appMetadata.ts',
    [`export const APP_DISPLAY_NAME = 'Kavi';`, `export const APP_VERSION = '${version}';`].join(
      '\n',
    ),
  );
  writeFixture(projectRoot, 'CHANGELOG.md', `# Changelog\n\n## [${version}] - 2026-06-18\n`);

  return projectRoot;
}

describe('app metadata checks', () => {
  it('parses Android and Xcode metadata values', () => {
    expect(
      parseAndroidGradle(`
        namespace 'com.kavi.mobile'
        applicationId 'com.kavi.mobile'
        versionCode 1
        versionName "1.0.0"
      `),
    ).toEqual({
      namespace: 'com.kavi.mobile',
      applicationId: 'com.kavi.mobile',
      versionCode: '1',
      versionName: '1.0.0',
    });

    expect(
      parseXcodeProject(`
        CURRENT_PROJECT_VERSION = 1;
        MARKETING_VERSION = 1.0.0;
        PRODUCT_BUNDLE_IDENTIFIER = com.kavi.app;
      `),
    ).toEqual({
      currentProjectVersions: ['1'],
      marketingVersions: ['1.0.0'],
      productBundleIdentifiers: ['com.kavi.app'],
    });
  });

  it('passes when public package, Expo, native, and runtime metadata are aligned', () => {
    const metadata = collectAppMetadata(createMetadataFixture());

    expect(findAppMetadataFailures(metadata)).toEqual([]);
  });

  it('detects version drift across app metadata files', () => {
    const metadata = collectAppMetadata(createMetadataFixture({ expoVersion: '1.0.1' }));

    expect(findAppMetadataFailures(metadata)).toEqual(
      expect.arrayContaining([
        'Expo version is "1.0.1", expected "1.0.0"',
        'iOS CFBundleShortVersionString is "1.0.1", expected "1.0.0"',
        'Xcode MARKETING_VERSION values are ["1.0.1"], expected only "1.0.0"',
        'Android versionName is "1.0.1", expected "1.0.0"',
      ]),
    );
  });

  it('detects native identifier drift from the public app identity policy', () => {
    const metadata = collectAppMetadata(
      createMetadataFixture({
        iosBundleIdentifier: 'com.example.ios',
        androidApplicationId: 'com.example.android',
      }),
    );

    expect(findAppMetadataFailures(metadata)).toEqual(
      expect.arrayContaining([
        'Expo iOS bundle identifier is "com.example.ios", expected "com.kavi.app"',
        'Xcode product bundle identifiers is "com.example.ios", expected "com.kavi.app"',
        'Expo Android package is "com.example.android", expected "com.kavi.mobile"',
        'Android namespace is "com.example.android", expected "com.kavi.mobile"',
        'Android applicationId is "com.example.android", expected "com.kavi.mobile"',
      ]),
    );
  });
});
