// ---------------------------------------------------------------------------
// Kavi — Structural turn descriptor (typed, versioned machine format)
// ---------------------------------------------------------------------------
// The deterministic extractor never has real prose to summarize a turn with,
// so it records a content-free, language-agnostic structural descriptor
// instead. This descriptor is a machine format owned entirely by product
// code — never natural language — so parsing it back is a strict, versioned
// structural decode, not a text heuristic.
//
// This module is the single place that builds, serializes, and parses that
// format. Every consumer (the extractor that writes it, the one-time schema
// backfill that retags legacy rows, and the presentation helper that renders
// it for a person) goes through the same strict parse here, so no consumer
// re-implements a slightly different JSON.parse of our own format.
// ---------------------------------------------------------------------------

export const STRUCTURAL_TURN_DESCRIPTOR_KIND = 'structural_turn' as const;
export const STRUCTURAL_TURN_DESCRIPTOR_VERSION = 1 as const;

export interface StructuralTurnDescriptor {
  kind: typeof STRUCTURAL_TURN_DESCRIPTOR_KIND;
  version: typeof STRUCTURAL_TURN_DESCRIPTOR_VERSION;
  messageCount: number;
  toolCallCount: number;
  completedToolCallCount: number;
  hasCodeBlock: boolean;
  hasAttachments: boolean;
}

export function serializeStructuralTurnDescriptor(descriptor: StructuralTurnDescriptor): string {
  return JSON.stringify(descriptor);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Strict structural parse of our own machine-owned descriptor format.
 * Validates the exact versioned shape written by `buildStructuralTurnDescriptor`
 * and returns null on any mismatch — malformed input, a future/older version,
 * or a field of the wrong type or shape. Callers must fall back to typed
 * fields (never to the raw string) when this returns null.
 */
export function parseStructuralTurnDescriptor(raw: string): StructuralTurnDescriptor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.kind !== STRUCTURAL_TURN_DESCRIPTOR_KIND) return null;
  if (candidate.version !== STRUCTURAL_TURN_DESCRIPTOR_VERSION) return null;
  if (
    !isNonNegativeInteger(candidate.messageCount) ||
    !isNonNegativeInteger(candidate.toolCallCount) ||
    !isNonNegativeInteger(candidate.completedToolCallCount) ||
    typeof candidate.hasCodeBlock !== 'boolean' ||
    typeof candidate.hasAttachments !== 'boolean'
  ) {
    return null;
  }
  return {
    kind: STRUCTURAL_TURN_DESCRIPTOR_KIND,
    version: STRUCTURAL_TURN_DESCRIPTOR_VERSION,
    messageCount: candidate.messageCount,
    toolCallCount: candidate.toolCallCount,
    completedToolCallCount: candidate.completedToolCallCount,
    hasCodeBlock: candidate.hasCodeBlock,
    hasAttachments: candidate.hasAttachments,
  };
}
