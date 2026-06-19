const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Public Domain',
  'Python-2.0',
  'Unlicense',
]);

const ALLOWED_LICENSE_EXPRESSIONS = new Map([
  [
    '(BSD-2-Clause OR MIT OR Apache-2.0)',
    'Permissive alternatives are available under BSD-2-Clause, MIT, or Apache-2.0.',
  ],
  [
    '(BSD-3-Clause OR GPL-2.0)',
    'Policy relies on the BSD-3-Clause alternative; do not use the GPL-2.0 alternative.',
  ],
  ['(MIT OR Apache-2.0)', 'Permissive alternatives are available under MIT or Apache-2.0.'],
  ['(MIT OR CC0-1.0)', 'Permissive alternatives are available under MIT or CC0-1.0.'],
  ['(MIT OR WTFPL)', 'Policy relies on the MIT alternative; do not use the WTFPL alternative.'],
]);

const MISSING_LOCKFILE_LICENSE_ALLOWLIST = new Map([
  [
    'exit@0.1.2',
    {
      license: 'MIT',
      rationale:
        'The lockfile entry omits a license field; the package metadata declares MIT through its licenses array and ships LICENSE-MIT.',
    },
  ],
]);

const PROHIBITED_LICENSE_PATTERNS = [
  /\bAGPL\b/i,
  /\bBUSL\b/i,
  /\bCommons-Clause\b/i,
  /\bGPL\b/i,
  /\bLGPL\b/i,
  /\bPolyForm\b/i,
  /\bSSPL\b/i,
  /\bUNLICENSED\b/i,
];

function normalizeLicense(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
}

function hasProhibitedLicenseToken(license) {
  return PROHIBITED_LICENSE_PATTERNS.some((pattern) => pattern.test(license));
}

function validateLicensePolicy(rawLicense) {
  const license = normalizeLicense(rawLicense);
  if (!license) {
    return {
      allowed: false,
      reason: 'missing license metadata',
    };
  }

  if (ALLOWED_LICENSES.has(license)) {
    return {
      allowed: true,
      reason: 'allowed license identifier',
    };
  }

  if (ALLOWED_LICENSE_EXPRESSIONS.has(license)) {
    return {
      allowed: true,
      reason: ALLOWED_LICENSE_EXPRESSIONS.get(license),
    };
  }

  if (hasProhibitedLicenseToken(license)) {
    return {
      allowed: false,
      reason: `prohibited license policy match: ${license}`,
    };
  }

  return {
    allowed: false,
    reason: `unreviewed license metadata: ${license}`,
  };
}

module.exports = {
  ALLOWED_LICENSES,
  ALLOWED_LICENSE_EXPRESSIONS,
  MISSING_LOCKFILE_LICENSE_ALLOWLIST,
  normalizeLicense,
  validateLicensePolicy,
};
