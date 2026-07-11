const { readFileSync } = require('fs');
const { join } = require('path');

describe('iOS Podfile build settings', () => {
  it('disables Swift explicit modules only for the required ExpoSQLite target', () => {
    const podfile = readFileSync(join(__dirname, '../../ios/Podfile'), 'utf8');
    const overrideStart = podfile.indexOf(
      'expo_sqlite_target = installer.pods_project.targets.find do |target|',
    );
    const nextGlobalSettingBlock = podfile.indexOf(
      'installer.pods_project.build_configurations.each',
      overrideStart,
    );

    expect(overrideStart).toBeGreaterThan(-1);
    expect(nextGlobalSettingBlock).toBeGreaterThan(overrideStart);

    const targetScopedOverride = podfile.slice(overrideStart, nextGlobalSettingBlock);
    expect(targetScopedOverride).toContain("target.name == 'ExpoSQLite'");
    expect(targetScopedOverride).toContain(
      "raise Pod::Informative, 'Expected the ExpoSQLite pod target to be installed'",
    );
    expect(targetScopedOverride).toContain('expo_sqlite_target.build_configurations.each');
    expect(targetScopedOverride).toContain(
      "build_config.build_settings['SWIFT_ENABLE_EXPLICIT_MODULES'] = 'NO'",
    );
    expect(podfile.match(/SWIFT_ENABLE_EXPLICIT_MODULES/g)).toHaveLength(1);
  });
});
