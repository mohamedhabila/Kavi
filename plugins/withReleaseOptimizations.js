// ---------------------------------------------------------------------------
// Expo Config Plugin — Release Build Optimizations
// ---------------------------------------------------------------------------
// Persists Android architecture filtering across `expo prebuild --clean` by
// modifying gradle.properties during the prebuild phase.
//
// Only ARM architectures (armeabi-v7a, arm64-v8a) are included in release
// builds. x86/x86_64 are emulator-only and roughly double the APK size.

const { withGradleProperties } = require('expo/config-plugins');

function withReleaseOptimizations(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;

    // Replace the default 4-architecture value with ARM-only
    const archIndex = props.findIndex(
      (p) => p.type === 'property' && p.key === 'reactNativeArchitectures',
    );
    const armOnly = {
      type: 'property',
      key: 'reactNativeArchitectures',
      value: 'armeabi-v7a,arm64-v8a',
    };
    if (archIndex !== -1) {
      props[archIndex] = armOnly;
    } else {
      props.push(armOnly);
    }

    return cfg;
  });
}

module.exports = withReleaseOptimizations;
