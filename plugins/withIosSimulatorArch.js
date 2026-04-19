// ---------------------------------------------------------------------------
// Expo Config Plugin — iOS Simulator Architecture Exclusion
// ---------------------------------------------------------------------------
// NMSSH ships pre-built static libraries (libcrypto, libssl, libssh2) whose
// arm64 slices target iOS-device, not iOS-simulator. On Apple Silicon the
// simulator defaults to arm64, causing a linker platform mismatch.
//
// This plugin sets EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64 on every Xcode
// target so that simulator builds run under Rosetta (x86_64), which the
// pre-built libraries support. It replaces the manual Podfile post_install
// workaround and survives `expo prebuild --clean`.

const { withXcodeProject } = require('expo/config-plugins');

function withIosSimulatorArch(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const xcBuildConfigs = project.hash.project.objects.XCBuildConfiguration;

    for (const key of Object.keys(xcBuildConfigs)) {
      const entry = xcBuildConfigs[key];
      // XCBuildConfiguration entries alternate between the config object
      // (with buildSettings) and a plain-string comment. Skip comments.
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      entry.buildSettings['"EXCLUDED_ARCHS[sdk=iphonesimulator*]"'] = 'arm64';
    }

    return cfg;
  });
}

module.exports = withIosSimulatorArch;
