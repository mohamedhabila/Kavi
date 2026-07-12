import type { MemoryFactKind } from './facts/types';
import type { MemoryFactSensitivity } from './facts/applicabilityProvenance';

/**
 * Version of the deterministic fact-sensitivity policy persisted with each
 * classified row. Database defaults intentionally remain at zero so direct
 * and legacy writes stay fail-closed until product code classifies them.
 */
export const MEMORY_FACT_SENSITIVITY_POLICY_VERSION = 1;

export interface MemorySensitivityInput {
  subject?: string | null;
  subjectType?: string | null;
  predicate: string;
  objectText: string;
  attributes?: Record<string, unknown>;
  sourceSummary?: string | null;
  memoryKind?: MemoryFactKind;
}

const SENSITIVITY_RANK: Readonly<Record<MemoryFactSensitivity, number>> = {
  normal: 0,
  personal: 1,
  sensitive: 2,
  restricted: 3,
};

const RESTRICTED_SINGLE_UNITS = new Set(
  'credential credentials mnemonic otp passcode passphrase passwd password passwords pin secret secrets totp'.split(
    ' ',
  ),
);
const RESTRICTED_PHRASES = [
  'access key',
  'access token',
  'api key',
  'auth token',
  'authentication token',
  'backup code',
  'bearer token',
  'private key',
  'recovery code',
  'refresh token',
  'seed phrase',
  'session cookie',
  'signing key',
  'verification code',
] as const;
const SENSITIVE_SINGLE_UNITS = new Set(
  'allergies allergy diagnosis iban medication medications medicine passport prescription prescriptions salary ssn'.split(
    ' ',
  ),
);
const SENSITIVE_PHRASES = [
  'account number',
  'authentication method',
  'bank account',
  'billing address',
  'blood type',
  'card number',
  'credit card',
  'criminal record',
  'debit card',
  'driver license',
  'driving license',
  'emergency contact',
  'financial account',
  'gender identity',
  'health condition',
  'home address',
  'medical condition',
  'medical history',
  'national id',
  'phone number',
  'precise location',
  'sexual orientation',
  'shipping address',
  'tax id',
  '2 fa method',
  'two factor method',
] as const;
const SENSITIVE_CONTEXT_UNITS = new Set(
  'address bank billing card coordinate coordinates email finance financial health legal medical phone religion religious tax'.split(
    ' ',
  ),
);
const PERSONAL_UNITS = new Set(
  'age birthday birthdate child children citizenship city family hometown language marital nationality occupation pet profession pronoun pronouns residence'.split(
    ' ',
  ),
);

const CREDENTIAL_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/u,
  /\bsk-[A-Za-z0-9_-]{8,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/u,
] as const;

function semanticUnits(value: string): string[] {
  const normalized = value
    .normalize('NFKC')
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .toLocaleLowerCase();
  return Array.from(normalized.matchAll(/[\p{L}\p{M}\p{N}]+/gu), (match) => match[0]);
}

function boundedAttributeText(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value).slice(0, 1_000)];
  }
  if (Array.isArray(value)) {
    return value.slice(0, 32).flatMap((entry) => boundedAttributeText(entry, depth + 1));
  }
  if (typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 64)
    .flatMap(([key, entry]) => [key, ...boundedAttributeText(entry, depth + 1)]);
}

function includesPhrase(phraseText: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => ` ${phraseText} `.includes(` ${phrase} `));
}

export function maxMemoryFactSensitivity(
  ...levels: readonly MemoryFactSensitivity[]
): MemoryFactSensitivity {
  return levels.reduce<MemoryFactSensitivity>(
    (maximum, level) => (SENSITIVITY_RANK[level] > SENSITIVITY_RANK[maximum] ? level : maximum),
    'normal',
  );
}

/** Deterministic, code-owned classification for every persisted fact projection. */
export function classifyMemoryFactSensitivity(
  input: MemorySensitivityInput,
): MemoryFactSensitivity {
  const attributeText = boundedAttributeText(input.attributes);
  const predicateUnits = semanticUnits(input.predicate);
  const allText = [
    input.subject ?? '',
    input.subjectType ?? '',
    input.predicate,
    input.objectText,
    input.sourceSummary ?? '',
    input.memoryKind ?? 'semantic_fact',
    ...attributeText,
  ].join(' ');
  const units = semanticUnits(allText);
  const unitSet = new Set(units);
  const phraseText = units.join(' ');
  const normalizedObject = input.objectText.normalize('NFKC');
  const selfLikeSubject =
    input.subjectType === 'self' || input.subjectType === 'person' || input.subject === 'user';

  if (
    units.some((unit) => RESTRICTED_SINGLE_UNITS.has(unit)) ||
    includesPhrase(phraseText, RESTRICTED_PHRASES) ||
    CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(normalizedObject)) ||
    (selfLikeSubject && predicateUnits.length === 1 && predicateUnits[0] === 'token')
  ) {
    return 'restricted';
  }

  if (
    units.some((unit) => SENSITIVE_SINGLE_UNITS.has(unit)) ||
    includesPhrase(phraseText, SENSITIVE_PHRASES) ||
    predicateUnits.some((unit) => SENSITIVE_CONTEXT_UNITS.has(unit)) ||
    (unitSet.has('two') && unitSet.has('factor')) ||
    (unitSet.has('2fa') && (unitSet.has('method') || unitSet.has('backup')))
  ) {
    return 'sensitive';
  }

  if (predicateUnits.some((unit) => PERSONAL_UNITS.has(unit))) return 'personal';
  return 'normal';
}
