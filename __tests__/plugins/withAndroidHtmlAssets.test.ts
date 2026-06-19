// ---------------------------------------------------------------------------
// Tests — withAndroidHtmlAssets Expo config plugin
// ---------------------------------------------------------------------------

const fs = require('fs');

let capturedCallback: ((cfg: any) => any) | null = null;

jest.mock('expo/config-plugins', () => ({
  withDangerousMod: (config: any, [_platform, callback]: [string, (cfg: any) => any]) => {
    capturedCallback = callback;
    return config;
  },
}));

// Pull in the plugin (after mock is set up)
const withAndroidHtmlAssets = require('../../plugins/withAndroidHtmlAssets');

jest.mock('fs');

describe('withAndroidHtmlAssets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedCallback = null;
  });

  it('should register a withDangerousMod callback for android', () => {
    withAndroidHtmlAssets({ name: 'test', slug: 'test' });
    expect(capturedCallback).not.toBeNull();
  });

  it('should copy editor and terminal files when callback is invoked', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
    (fs.readdirSync as jest.Mock).mockReturnValue([
      { name: 'editor.html', isDirectory: () => false },
    ]);
    (fs.copyFileSync as jest.Mock).mockImplementation(() => {});

    withAndroidHtmlAssets({ name: 'test', slug: 'test' });
    expect(capturedCallback).not.toBeNull();

    const cfg = {
      modRequest: { projectRoot: '/fake/project' },
    };

    const result = capturedCallback!(cfg);
    expect(result).toBe(cfg);

    // Two source directories exist → mkdirSync called for both
    expect(fs.mkdirSync).toHaveBeenCalledTimes(2);
    // Two source directories → readdirSync called for both
    expect(fs.readdirSync).toHaveBeenCalledTimes(2);
    // Each directory has one file → copyFileSync called twice
    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
  });

  it('skips non-existent source directories gracefully', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    withAndroidHtmlAssets({ name: 'test', slug: 'test' });

    const cfg = { modRequest: { projectRoot: '/fake/project' } };
    const result = capturedCallback!(cfg);
    expect(result).toBe(cfg);

    // No files to copy
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });
});
