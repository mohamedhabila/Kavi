// ---------------------------------------------------------------------------
// Tests — Android release networking config
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

describe('Android release networking config', () => {
  it('keeps expo/fetch native request classes for release builds', () => {
    const rulesPath = path.join(__dirname, '..', '..', 'android', 'app', 'proguard-rules.pro');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    expect(rules).toMatch(/-keep class expo\.modules\.fetch\.\*\* \{ \*; \}/);
  });

  it('keeps Expo Kotlin record converters used by expo/fetch release marshalling', () => {
    const rulesPath = path.join(__dirname, '..', '..', 'android', 'app', 'proguard-rules.pro');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    expect(rules).toMatch(/-keep class expo\.modules\.kotlin\.records\.\*\* \{ \*; \}/);
    expect(rules).toMatch(/-keep class expo\.modules\.kotlin\.types\.\*\* \{ \*; \}/);
  });
});
