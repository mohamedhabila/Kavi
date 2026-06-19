const fs = require('fs');
const path = require('path');

const {
  ALLOWED_LICENSES,
  ALLOWED_LICENSE_EXPRESSIONS,
  MISSING_LOCKFILE_LICENSE_ALLOWLIST,
  normalizeLicense,
  validateLicensePolicy,
} = require('./dependencyLicensePolicy');

const CHECK_LABEL = 'check-dependency-licenses';
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md';

function readJson(projectRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function packageNameFromLockPath(lockPath) {
  const segments = lockPath.split('/');
  const nodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nodeModulesIndex === -1 || nodeModulesIndex + 1 >= segments.length) {
    return null;
  }

  const firstNameSegment = segments[nodeModulesIndex + 1];
  if (firstNameSegment.startsWith('@')) {
    const packageNameSegment = segments[nodeModulesIndex + 2];
    return packageNameSegment ? `${firstNameSegment}/${packageNameSegment}` : null;
  }

  return firstNameSegment;
}

function packageKey(packageName, version) {
  return `${packageName}@${version}`;
}

function directDependencyScope(packageName, packageJson) {
  if (packageJson.dependencies?.[packageName]) {
    return 'runtime';
  }
  if (packageJson.devDependencies?.[packageName]) {
    return 'development';
  }
  return 'transitive';
}

function mergeScope(currentScope, nextScope) {
  const priority = {
    runtime: 3,
    development: 2,
    transitive: 1,
  };
  return priority[nextScope] > priority[currentScope] ? nextScope : currentScope;
}

function collectDependencyLicenseInventory(projectRoot = path.resolve(__dirname, '../..')) {
  return collectDependencyLicenseInventoryFromData({
    packageJson: readJson(projectRoot, 'package.json'),
    packageLock: readJson(projectRoot, 'package-lock.json'),
  });
}

function collectDependencyLicenseInventoryFromData({ packageJson, packageLock }) {
  const packages = new Map();
  const failures = [];
  const allowlistedMissingLicenses = [];
  const lockPackages = packageLock.packages || {};

  for (const [lockPath, metadata] of Object.entries(lockPackages)) {
    if (!lockPath) {
      continue;
    }

    const packageName = packageNameFromLockPath(lockPath);
    const version = metadata?.version;
    if (!packageName || !version) {
      failures.push(`${lockPath}: unable to determine package name and version`);
      continue;
    }

    const key = packageKey(packageName, version);
    const allowlistEntry = MISSING_LOCKFILE_LICENSE_ALLOWLIST.get(key);
    const rawLockfileLicense = normalizeLicense(metadata.license);
    const resolvedLicense = rawLockfileLicense || allowlistEntry?.license || '';
    const licenseDecision = validateLicensePolicy(resolvedLicense);

    if (!rawLockfileLicense) {
      if (allowlistEntry) {
        allowlistedMissingLicenses.push({
          packageName,
          version,
          license: allowlistEntry.license,
          rationale: allowlistEntry.rationale,
        });
      } else {
        failures.push(
          `${key}: missing lockfile license metadata; add reviewed metadata or an explicit allowlist entry with rationale`,
        );
        continue;
      }
    }

    if (!licenseDecision.allowed) {
      failures.push(`${key}: ${licenseDecision.reason}`);
      continue;
    }

    const nextPackage = {
      name: packageName,
      version,
      scope: directDependencyScope(packageName, packageJson),
      license: resolvedLicense,
      lockPaths: [lockPath],
    };
    const existingPackage = packages.get(key);
    if (existingPackage) {
      existingPackage.scope = mergeScope(existingPackage.scope, nextPackage.scope);
      existingPackage.lockPaths.push(lockPath);
    } else {
      packages.set(key, nextPackage);
    }
  }

  const packageRows = Array.from(packages.values()).sort((a, b) => {
    const nameComparison = a.name.localeCompare(b.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }
    return a.version.localeCompare(b.version);
  });

  const licenseSummary = summarizeLicenses(packageRows);

  return {
    packages: packageRows,
    licenseSummary,
    allowlistedMissingLicenses: uniqueAllowlistEntries(allowlistedMissingLicenses),
    failures,
  };
}

function uniqueAllowlistEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = packageKey(entry.packageName, entry.version);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function summarizeLicenses(packageRows) {
  const counts = new Map();
  for (const packageRow of packageRows) {
    counts.set(packageRow.license, (counts.get(packageRow.license) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([license, count]) => ({ license, count }))
    .sort((a, b) => a.license.localeCompare(b.license));
}

function escapeMarkdownCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function markdownTable(headers, rows) {
  const headerLine = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map(
    (row) => `| ${row.map((value) => escapeMarkdownCell(value)).join(' | ')} |`,
  );
  return [headerLine, separatorLine, ...rowLines].join('\n');
}

function renderThirdPartyNotices(inventory) {
  const allowlistRows =
    inventory.allowlistedMissingLicenses.length > 0
      ? inventory.allowlistedMissingLicenses.map((entry) => [
          packageKey(entry.packageName, entry.version),
          entry.license,
          entry.rationale,
        ])
      : [['None', 'n/a', 'No lockfile metadata exceptions are active.']];

  const expressionRows = Array.from(ALLOWED_LICENSE_EXPRESSIONS.entries()).map(
    ([expression, rationale]) => [expression, rationale],
  );

  return `${[
    '# Third-Party Notices',
    '',
    'This file is generated from `package-lock.json` by `node ./scripts/check-dependency-licenses.js --write`.',
    'Do not edit it by hand. Run `npm run check:licenses` after dependency changes to verify that it still matches the lockfile.',
    '',
    '## License Policy',
    '',
    'Kavi accepts the dependency license identifiers and reviewed expressions listed below. Any new license metadata must be reviewed before it is added to this policy.',
    '',
    '### Allowed License Identifiers',
    '',
    markdownTable(
      ['License'],
      Array.from(ALLOWED_LICENSES)
        .sort((a, b) => a.localeCompare(b))
        .map((license) => [license]),
    ),
    '',
    '### Reviewed License Expressions',
    '',
    markdownTable(['Expression', 'Review note'], expressionRows),
    '',
    '## Lockfile Metadata Allowlist',
    '',
    markdownTable(['Package', 'Resolved license', 'Rationale'], allowlistRows),
    '',
    '## License Summary',
    '',
    markdownTable(
      ['License', 'Package entries'],
      inventory.licenseSummary.map((entry) => [entry.license, String(entry.count)]),
    ),
    '',
    '## Package Inventory',
    '',
    markdownTable(
      ['Package', 'Version', 'Scope', 'License'],
      inventory.packages.map((entry) => [entry.name, entry.version, entry.scope, entry.license]),
    ),
  ].join('\n')}\n`;
}

function checkNoticesFile(projectRoot, expectedContent) {
  const noticesPath = path.join(projectRoot, NOTICES_FILE);
  if (!fs.existsSync(noticesPath)) {
    return [`${NOTICES_FILE} is missing; run node ./scripts/check-dependency-licenses.js --write`];
  }

  const actualContent = fs.readFileSync(noticesPath, 'utf8');
  if (actualContent !== expectedContent) {
    return [
      `${NOTICES_FILE} is out of date with package-lock.json; run node ./scripts/check-dependency-licenses.js --write`,
    ];
  }

  return [];
}

function runDependencyLicenseCheckCli(
  argv = process.argv.slice(2),
  projectRoot = path.resolve(__dirname, '../..'),
) {
  const shouldWrite = argv.includes('--write');
  const inventory = collectDependencyLicenseInventory(projectRoot);
  const expectedNotices = renderThirdPartyNotices(inventory);

  const failures = [...inventory.failures];
  if (shouldWrite) {
    fs.writeFileSync(path.join(projectRoot, NOTICES_FILE), expectedNotices);
  } else {
    failures.push(...checkNoticesFile(projectRoot, expectedNotices));
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[${CHECK_LABEL}] ${failure}`);
    }
    process.exitCode = 1;
    return 1;
  }

  console.log(
    `[${CHECK_LABEL}] ${inventory.packages.length} package entries covered across ${inventory.licenseSummary.length} license policies.`,
  );
  return 0;
}

module.exports = {
  ALLOWED_LICENSES,
  ALLOWED_LICENSE_EXPRESSIONS,
  MISSING_LOCKFILE_LICENSE_ALLOWLIST,
  collectDependencyLicenseInventory,
  collectDependencyLicenseInventoryFromData,
  packageNameFromLockPath,
  renderThirdPartyNotices,
  runDependencyLicenseCheckCli,
  validateLicensePolicy,
};
