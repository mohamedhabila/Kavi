// ---------------------------------------------------------------------------
// Tests — iOS Simulator Arch Expo Config Plugin
// ---------------------------------------------------------------------------

const withIosSimulatorArch = require('../../plugins/withIosSimulatorArch');

describe('withIosSimulatorArch', () => {
  it('is a function', () => {
    expect(typeof withIosSimulatorArch).toBe('function');
  });

  it('returns a config object (expo config plugin convention)', () => {
    const input = { name: 'TestApp', slug: 'testapp' };
    const result = withIosSimulatorArch(input);
    // Expo config plugins return a modified config via the withXcodeProject mod
    // Since withXcodeProject is mocked by expo, the result should be the config
    expect(result).toBeDefined();
  });
});
