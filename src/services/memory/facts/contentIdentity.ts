export interface FactContentIdentityInput {
  memoryKind?: string | null;
  scope?: string | null;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originTaskId?: string | null;
  subjectId: string;
  predicate: string;
  objectText: string;
  objectEntityId?: string | null;
}

function normalizeScope(value: string | null | undefined): string {
  return value === 'project' ||
    value === 'conversation' ||
    value === 'session' ||
    value === 'persona'
    ? value
    : 'global';
}

function normalizeMemoryKind(value: string | null | undefined): string {
  return value?.trim() || 'semantic_fact';
}

function stableFingerprint128(value: string): string {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Stable identity for semantically identical active fact rows. */
export function buildFactContentHash(input: FactContentIdentityInput): string {
  const scope = normalizeScope(input.scope);
  const origin =
    scope === 'global'
      ? [null, null, null]
      : scope === 'conversation'
        ? [input.originConversationId ?? null, null, null]
        : [
            input.originConversationId ?? null,
            input.originThreadId ?? input.originConversationId ?? null,
            input.originTaskId ?? null,
          ];
  const payload = JSON.stringify([
    normalizeMemoryKind(input.memoryKind),
    scope,
    ...origin,
    input.subjectId,
    input.predicate.normalize('NFKC').trim().toLowerCase(),
    input.objectText.normalize('NFKC').trim(),
    input.objectEntityId ?? null,
  ]);
  return `v2_${stableFingerprint128(payload)}`;
}
