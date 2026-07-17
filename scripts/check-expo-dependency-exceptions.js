const packageManifest = require('../package.json');

const GESTURE_HANDLER_PACKAGE = 'react-native-gesture-handler';
const validatedDependencyTuple = Object.freeze({
  expo: '~55.0.28',
  reactNative: '0.83.6',
  gestureHandler: '~2.31.2',
});

const excludedPackages = packageManifest.expo?.install?.exclude ?? [];

if (!excludedPackages.includes(GESTURE_HANDLER_PACKAGE)) {
  console.log('No React Native Gesture Handler Expo dependency exception is configured.');
  process.exit(0);
}

const installedDependencyTuple = {
  expo: packageManifest.dependencies?.expo,
  reactNative: packageManifest.dependencies?.['react-native'],
  gestureHandler: packageManifest.dependencies?.[GESTURE_HANDLER_PACKAGE],
};

const mismatches = Object.entries(validatedDependencyTuple).filter(
  ([dependency, version]) => installedDependencyTuple[dependency] !== version,
);

if (mismatches.length > 0) {
  const details = mismatches
    .map(
      ([dependency, expected]) =>
        `${dependency}: expected ${expected}, found ${installedDependencyTuple[dependency] ?? 'missing'}`,
    )
    .join('\n');

  throw new Error(
    `The React Native Gesture Handler Expo dependency exception has not been validated for this SDK tuple.\n${details}\nRemove the exception and re-run Expo dependency checks before updating it.`,
  );
}

console.log(
  'React Native Gesture Handler Expo dependency exception matches its native-build-validated SDK tuple.',
);
