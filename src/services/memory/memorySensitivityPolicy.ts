import type { MemoryFactKind } from './facts/types';
import type { MemoryFactSensitivity } from './facts/applicabilityProvenance';
import { projectMemorySensitivityAttributes } from './memorySensitivityAttributes';
import {
  CREDENTIAL_FIELD_NAMES,
  CREDENTIAL_TEXT_PHRASES,
  PERSONAL_FIELD_NAMES,
  SELF_SENSITIVE_FIELD_NAMES,
  SENSITIVE_FIELD_NAMES,
  SENSITIVE_TEXT_PHRASES,
} from './memorySensitivityLexicon';
import { classifyStructuredMemoryText } from './memorySensitivityValidators';

/** Rows written under older classifiers stay restricted until v2 backfills them. */
export const MEMORY_FACT_SENSITIVITY_POLICY_VERSION = 2;

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

const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CREDENTIAL_DISCLOSURE_PHRASES = [
  'my password is',
  'my passcode is',
  'my api key is',
  'كلمة المرور الخاصة بي هي',
  'رمز المرور الخاص بي هو',
  'mein passwort ist',
  'mein api schlüssel ist',
  'mi contraseña es',
  'mi clave api es',
  'mon mot de passe est',
  'ma clé api est',
  '私のパスワードは',
  '私のapiキーは',
  'minha senha é',
  'minha chave api é',
  '我的密码是',
  '我的密碼是',
  '我的api密钥是',
  '我的api金鑰是',
] as const;
const EXACT_SENSITIVE_FIELD_NAMES = [
  'bank',
  'card',
  'coordinate',
  'coordinates',
  'email',
  'legal',
  'phone',
  'tax',
] as const;
const COMPOUND_CREDENTIAL_FIELD_NAMES = CREDENTIAL_FIELD_NAMES.filter((field) => field !== 'token');

function normalizeDecimalDigits(value: string): string {
  return value
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function normalizedSemanticText(value: string): string {
  return normalizeDecimalDigits(value.normalize('NFKC'))
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .toLowerCase()
    .replace(/[ـؐ-ًؚ-ٰٟۖ-ۭ]/gu, '')
    .replace(/[’'`´]/gu, ' ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function containsPhrase(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizedSemanticText(phrase);
  if (!normalizedPhrase) return false;
  if (CJK_SCRIPT.test(normalizedPhrase)) return normalizedText.includes(normalizedPhrase);
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function containsAnyPhrase(normalizedText: string, phrases: ReadonlyArray<string>): boolean {
  return phrases.some((phrase) => containsPhrase(normalizedText, phrase));
}

function exactFieldName(normalizedField: string, fields: ReadonlyArray<string>): boolean {
  return fields.some((field) => normalizedField === normalizedSemanticText(field));
}

function fieldMatchesAlias(normalizedField: string, aliases: ReadonlyArray<string>): boolean {
  return aliases.some((alias) => {
    const normalizedAlias = normalizedSemanticText(alias);
    if (normalizedField === normalizedAlias) return true;
    return CJK_SCRIPT.test(normalizedAlias)
      ? normalizedField.endsWith(normalizedAlias)
      : normalizedField.endsWith(` ${normalizedAlias}`);
  });
}

function validAge(raw: string | undefined): boolean {
  if (!raw) return false;
  const age = Number(raw);
  return Number.isInteger(age) && age >= 0 && age <= 130;
}

function hasNaturalAgeSemantics(text: string): boolean {
  const normalized = normalizedSemanticText(text);
  const patterns = [
    /\b(?:i am|i m)\s+(\d{1,3})\s+years?\s+old\b/u,
    /\bmy age is\s+(\d{1,3})\b/u,
    /(?:عمري|أبلغ من العمر|انا في سن|أنا في سن)\s+(\d{1,3})/u,
    /\b(?:ich bin\s+(\d{1,3})\s+jahre alt|mein alter ist\s+(\d{1,3}))\b/u,
    /\b(?:tengo\s+(\d{1,3})\s+años|mi edad es\s+(\d{1,3}))\b/u,
    /\b(?:j ai\s+(\d{1,3})\s+ans|mon âge est\s+(\d{1,3}))\b/u,
    /(?:年齢は|私は)?\s*(\d{1,3})\s*歳(?:です)?/u,
    /\b(?:tenho\s+(\d{1,3})\s+anos|minha idade é\s+(\d{1,3}))\b/u,
    /(?:我今年|我|年龄是|年齡是)\s*(\d{1,3})\s*[岁歲]/u,
  ] as const;
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match.slice(1).some(validAge)) return true;
  }
  return false;
}

function hasNaturalPersonalDisclosure(normalized: string): boolean {
  return PERSONAL_FIELD_NAMES.some((field) => {
    const phrase = normalizedSemanticText(field);
    return (
      containsPhrase(normalized, `my ${phrase} is`) ||
      containsPhrase(normalized, `my ${phrase} are`)
    );
  });
}

export function maxMemoryFactSensitivity(
  ...levels: readonly MemoryFactSensitivity[]
): MemoryFactSensitivity {
  return levels.reduce<MemoryFactSensitivity>(
    (maximum, level) => (SENSITIVITY_RANK[level] > SENSITIVITY_RANK[maximum] ? level : maximum),
    'normal',
  );
}

/** Classify one prose value without treating generic nouns as field labels. */
export function classifyMemoryTextSensitivity(text: string): MemoryFactSensitivity {
  if (typeof text !== 'string') return 'restricted';
  const structured = classifyStructuredMemoryText(text);
  if (structured) return structured;
  const normalized = normalizedSemanticText(text);
  const hasCredentialLabel = containsAnyPhrase(normalized, CREDENTIAL_TEXT_PHRASES);
  const hasCredentialDisclosure =
    containsAnyPhrase(normalized, CREDENTIAL_DISCLOSURE_PHRASES) || /[:=]\s*\S{3,}/u.test(text);
  if (hasCredentialLabel && hasCredentialDisclosure) return 'restricted';
  if (containsAnyPhrase(normalized, SENSITIVE_TEXT_PHRASES)) return 'sensitive';
  if (hasNaturalAgeSemantics(text)) return 'personal';
  if (hasNaturalPersonalDisclosure(normalized)) return 'personal';
  return 'normal';
}

function classifyFieldSensitivity(
  fieldNames: ReadonlyArray<string>,
  selfLikeSubject: boolean,
): MemoryFactSensitivity {
  let sensitivity: MemoryFactSensitivity = 'normal';
  for (const fieldName of fieldNames) {
    const normalized = normalizedSemanticText(fieldName);
    if (
      fieldMatchesAlias(normalized, CREDENTIAL_TEXT_PHRASES) ||
      fieldMatchesAlias(normalized, COMPOUND_CREDENTIAL_FIELD_NAMES) ||
      (selfLikeSubject && normalized === 'token')
    ) {
      return 'restricted';
    }
    if (
      fieldMatchesAlias(normalized, SENSITIVE_TEXT_PHRASES) ||
      fieldMatchesAlias(normalized, SENSITIVE_FIELD_NAMES) ||
      exactFieldName(normalized, EXACT_SENSITIVE_FIELD_NAMES) ||
      (selfLikeSubject && fieldMatchesAlias(normalized, SELF_SENSITIVE_FIELD_NAMES))
    ) {
      sensitivity = maxMemoryFactSensitivity(sensitivity, 'sensitive');
    }
    if (selfLikeSubject && fieldMatchesAlias(normalized, PERSONAL_FIELD_NAMES)) {
      sensitivity = maxMemoryFactSensitivity(sensitivity, 'personal');
    }
  }
  return sensitivity;
}

/** Deterministic, field-aware classification for every persisted fact projection. */
export function classifyMemoryFactSensitivity(
  input: MemorySensitivityInput,
): MemoryFactSensitivity {
  const attributes = projectMemorySensitivityAttributes(input.attributes);
  if (attributes.truncated) return 'restricted';
  const normalizedSubject = normalizedSemanticText(input.subject ?? '');
  const normalizedSubjectType = normalizedSemanticText(input.subjectType ?? '');
  const selfLikeSubject =
    normalizedSubjectType === 'self' ||
    normalizedSubjectType === 'person' ||
    normalizedSubject === 'user';
  let sensitivity = classifyFieldSensitivity(
    [input.predicate, ...attributes.fieldNames],
    selfLikeSubject,
  );
  for (const attributeValue of attributes.values) {
    const normalized = normalizedSemanticText(attributeValue);
    if (
      exactFieldName(normalized, CREDENTIAL_TEXT_PHRASES) ||
      exactFieldName(normalized, CREDENTIAL_FIELD_NAMES)
    ) {
      return 'restricted';
    }
    if (
      exactFieldName(normalized, SENSITIVE_TEXT_PHRASES) ||
      exactFieldName(normalized, SENSITIVE_FIELD_NAMES)
    ) {
      sensitivity = maxMemoryFactSensitivity(sensitivity, 'sensitive');
    }
  }
  const subjectStructure = classifyStructuredMemoryText(input.subject ?? '');
  if (subjectStructure) sensitivity = maxMemoryFactSensitivity(sensitivity, subjectStructure);
  for (const text of [input.objectText, input.sourceSummary ?? '', ...attributes.values]) {
    sensitivity = maxMemoryFactSensitivity(sensitivity, classifyMemoryTextSensitivity(text));
    if (sensitivity === 'restricted') return sensitivity;
  }
  return sensitivity;
}
