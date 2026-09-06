const {
  countPhysicalLines,
  findMaintainabilityFailures,
  isPassThroughBarrel,
} = require('../../scripts/lib/maintainabilityCheck');

describe('maintainability checks', () => {
  it('flags contribution-facing files above the line limit while honoring explicit exceptions', () => {
    const oversized = Array.from({ length: 701 }, (_, index) => `line ${index}`).join('\n');
    const failures = findMaintainabilityFailures([
      { filePath: 'src/services/large.ts', content: oversized },
      { filePath: 'src/i18n/locales/en.ts', content: oversized },
      { filePath: 'THIRD_PARTY_NOTICES.md', content: oversized },
      { filePath: 'package-lock.json', content: oversized },
    ]);

    expect(failures).toEqual([
      expect.objectContaining({
        type: 'line-count',
        filePath: 'src/services/large.ts',
        lines: 701,
        maxLines: 700,
      }),
    ]);
  });

  it('detects pass-through barrel files without flagging implementation exports', () => {
    expect(
      isPassThroughBarrel(
        'src/engine/tools/domains/browser.ts',
        "import { thing } from './thing';\nexport { thing };\n",
      ),
    ).toBe(true);
    expect(isPassThroughBarrel('src/index.ts', "export * from './implementation';\n")).toBe(true);
    expect(
      isPassThroughBarrel(
        'src/services/implementation.ts',
        'export const value = 1;\nexport function run() { return value; }\n',
      ),
    ).toBe(false);
  });

  it('counts physical lines consistently with the repository limit', () => {
    expect(countPhysicalLines('one\ntwo\n')).toBe(2);
    expect(countPhysicalLines('one\ntwo')).toBe(2);
  });
});
