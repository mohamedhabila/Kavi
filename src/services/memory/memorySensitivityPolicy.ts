import {
  closedMemoryFactSensitivity,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import { projectMemorySensitivityAttributes } from './memorySensitivityAttributes';
import { classifyStructuredMemoryText } from './memorySensitivityValidators';

/** Rows classified by any earlier policy are fail-closed at read time. */
export const MEMORY_FACT_SENSITIVITY_POLICY_VERSION = 3;
export const MEMORY_SENSITIVITY_DECLARATION_VERSION = 1 as const;

export const MEMORY_SENSITIVITY_DECLARATION_SOURCES = ['provider', 'code_owned'] as const;
export type MemorySensitivityDeclarationSource =
  (typeof MEMORY_SENSITIVITY_DECLARATION_SOURCES)[number];

/**
 * A typed lower bound supplied by the producer that owns the fact semantics.
 * This declaration can only restrict persistence and recall; it grants no write
 * authority, applicability, scope, or retrieval permission.
 */
export interface MemorySensitivityDeclarationV1 {
  version: typeof MEMORY_SENSITIVITY_DECLARATION_VERSION;
  source: MemorySensitivityDeclarationSource;
  sensitivity: MemoryFactSensitivity;
}

export interface MemorySensitivityInput {
  /** Missing or invalid declarations are classified as restricted. */
  declaredSensitivity: unknown;
  subject?: string | null;
  predicate: string;
  objectText: string;
  attributes?: Record<string, unknown>;
  sourceSummary?: string | null;
}

const SENSITIVITY_RANK: Readonly<Record<MemoryFactSensitivity, number>> = {
  normal: 0,
  personal: 1,
  sensitive: 2,
  restricted: 3,
};

export function maxMemoryFactSensitivity(
  ...levels: readonly MemoryFactSensitivity[]
): MemoryFactSensitivity {
  return levels.reduce<MemoryFactSensitivity>(
    (maximum, level) => (SENSITIVITY_RANK[level] > SENSITIVITY_RANK[maximum] ? level : maximum),
    'normal',
  );
}

export function requireMemorySensitivityDeclaration(
  value: unknown,
  code = 'memory_sensitivity_declaration_invalid',
): MemorySensitivityDeclarationV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  const declaration = value as Record<string, unknown>;
  const keys = Object.keys(declaration).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'sensitivity' ||
    keys[1] !== 'source' ||
    keys[2] !== 'version' ||
    declaration.version !== MEMORY_SENSITIVITY_DECLARATION_VERSION ||
    !MEMORY_SENSITIVITY_DECLARATION_SOURCES.includes(
      declaration.source as MemorySensitivityDeclarationSource,
    )
  ) {
    throw new Error(code);
  }
  const sensitivity = closedMemoryFactSensitivity(declaration.sensitivity);
  if (!sensitivity) throw new Error(code);
  return {
    version: MEMORY_SENSITIVITY_DECLARATION_VERSION,
    source: declaration.source as MemorySensitivityDeclarationSource,
    sensitivity,
  };
}

export function providerMemorySensitivityDeclaration(
  sensitivity: unknown,
): MemorySensitivityDeclarationV1 {
  const closed = closedMemoryFactSensitivity(sensitivity);
  if (!closed) throw new Error('provider_memory_sensitivity_invalid');
  return {
    version: MEMORY_SENSITIVITY_DECLARATION_VERSION,
    source: 'provider',
    sensitivity: closed,
  };
}

export function codeOwnedMemorySensitivityDeclaration(
  sensitivity: MemoryFactSensitivity = 'normal',
): MemorySensitivityDeclarationV1 {
  return {
    version: MEMORY_SENSITIVITY_DECLARATION_VERSION,
    source: 'code_owned',
    sensitivity,
  };
}

/** Classify one prose value using only high-confidence, format-level structure. */
export function classifyMemoryTextSensitivity(text: string): MemoryFactSensitivity {
  if (typeof text !== 'string') return 'restricted';
  return classifyStructuredMemoryText(text) ?? 'normal';
}

/**
 * Apply the producer declaration as an immutable floor. Code-owned structural
 * detectors may only raise that floor; field names and natural-language prose
 * never change it.
 */
export function classifyMemoryFactSensitivity(
  input: MemorySensitivityInput,
): MemoryFactSensitivity {
  const declared = closedMemoryFactSensitivity(input.declaredSensitivity);
  if (!declared) return 'restricted';
  const attributes = projectMemorySensitivityAttributes(input.attributes);
  if (attributes.truncated) return 'restricted';

  let sensitivity = declared;
  for (const text of [
    input.subject ?? '',
    input.predicate,
    input.objectText,
    input.sourceSummary ?? '',
    ...attributes.fieldNames,
    ...attributes.values,
  ]) {
    sensitivity = maxMemoryFactSensitivity(sensitivity, classifyMemoryTextSensitivity(text));
    if (sensitivity === 'restricted') return sensitivity;
  }
  return sensitivity;
}
