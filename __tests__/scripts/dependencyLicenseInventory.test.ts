const { join } = require('path');

const {
  collectDependencyLicenseInventory,
  collectDependencyLicenseInventoryFromData,
  packageNameFromLockPath,
  renderThirdPartyNotices,
  validateLicensePolicy,
} = require('../../scripts/lib/dependencyLicenseInventory');

const legacyProjectBrandPattern = ['open', 'claw'].join('');

describe('dependency license inventory', () => {
  it('covers the current lockfile and documents reviewed metadata exceptions', () => {
    const projectRoot = join(__dirname, '../..');
    const inventory = collectDependencyLicenseInventory(projectRoot);
    const notices = renderThirdPartyNotices(inventory);

    expect(inventory.failures).toEqual([]);
    expect(inventory.packages.length).toBeGreaterThan(1000);
    expect(inventory.allowlistedMissingLicenses).toEqual([
      expect.objectContaining({
        packageName: 'exit',
        version: '0.1.2',
        license: 'MIT',
      }),
    ]);
    expect(notices).toContain('exit@0.1.2');
    expect(notices).not.toMatch(
      new RegExp(`${legacyProjectBrandPattern}|unknown license|TODO license`, 'i'),
    );
  });

  it('fails packages with missing or blocked license metadata unless reviewed', () => {
    const inventory = collectDependencyLicenseInventoryFromData({
      packageJson: {
        dependencies: {
          safe: '^1.0.0',
        },
        devDependencies: {},
      },
      packageLock: {
        packages: {
          '': {},
          'node_modules/safe': {
            version: '1.0.0',
            license: 'MIT',
          },
          'node_modules/missing-license': {
            version: '1.0.0',
          },
          'node_modules/blocked-license': {
            version: '1.0.0',
            license: 'GPL-3.0-only',
          },
          'node_modules/unreviewed-license': {
            version: '1.0.0',
            license: 'Custom-1.0',
          },
        },
      },
    });

    expect(inventory.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing-license@1.0.0: missing lockfile license metadata'),
        expect.stringContaining('blocked-license@1.0.0: prohibited license policy match'),
        expect.stringContaining('unreviewed-license@1.0.0: unreviewed license metadata'),
      ]),
    );
  });

  it('accepts reviewed dual-license expressions and rejects unreviewed copyleft-only licenses', () => {
    expect(validateLicensePolicy('(BSD-3-Clause OR GPL-2.0)')).toEqual(
      expect.objectContaining({
        allowed: true,
      }),
    );
    expect(validateLicensePolicy('(MIT OR WTFPL)')).toEqual(
      expect.objectContaining({
        allowed: true,
      }),
    );
    expect(validateLicensePolicy('GPL-3.0-only')).toEqual(
      expect.objectContaining({
        allowed: false,
      }),
    );
  });

  it('extracts scoped package names from nested lockfile paths', () => {
    expect(packageNameFromLockPath('node_modules/@scope/package')).toBe('@scope/package');
    expect(packageNameFromLockPath('node_modules/a/node_modules/@scope/package')).toBe(
      '@scope/package',
    );
    expect(packageNameFromLockPath('node_modules/a/node_modules/b')).toBe('b');
  });
});
