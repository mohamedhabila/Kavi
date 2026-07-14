import { sha256HexUtf8 } from '../../../src/utils/sha256';
import {
  buildMemoryFactContributionId,
  decodeMemoryFactContributionPayload,
  encodeMemoryFactContributionPayload,
  normalizeMemoryFactContributionSourceAliases,
  normalizeMemoryFactContributionSourceScope,
  requireMemoryFactContributionProducerIdentity,
  type MemoryFactContributionPayloadV1,
} from '../../../src/services/memory/factContributionCodec';

function payload(attributes: Record<string, unknown> = {}): MemoryFactContributionPayloadV1 {
  return {
    version: 1,
    operation: { kind: 'record' },
    applicability: {
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
      personaId: null,
    },
    input: {
      subjectId: 'entity-user',
      predicate: 'favorite_color',
      objectText: 'blue',
      objectEntityId: null,
      attributes,
      confidence: 0.9,
      sourceMessageId: 'message-user',
      sourceRunId: 'run-1',
      scope: 'global',
      originConversationId: null,
      originThreadId: null,
      originTaskId: null,
      sourceTurnId: 'message-assistant',
      sourceSummary: 'The user explicitly stated this preference.',
      importance: 0.8,
      decayPolicy: 'slow',
      expiresAt: null,
      validAt: 100,
      pinned: false,
      sourceActorId: null,
      retrievability: 0.95,
      stability: 0.7,
      decayRate: 0.02,
      reviewState: 'auto',
      memoryKind: 'semantic_fact',
      supersedePrior: false,
      now: 100,
    },
  };
}

describe('fact contribution codec', () => {
  it('round-trips strict V1 metadata with canonical JSON and SHA-256', () => {
    const encoded = encodeMemoryFactContributionPayload(
      payload({ z: 3, nested: { second: true, first: 'value' }, a: 1 }),
    );
    const equivalent = encodeMemoryFactContributionPayload(
      payload({ a: 1, nested: { first: 'value', second: true }, z: 3 }),
    );

    expect(encoded).toEqual(equivalent);
    expect(encoded.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new TextEncoder().encode(encoded.payloadJson).byteLength).toBe(
      encoded.payloadByteLength,
    );
    expect(decodeMemoryFactContributionPayload(encoded)).toEqual(equivalentPayload());
  });

  it('rejects envelope tampering, non-canonical JSON, extra fields, and oversized values', () => {
    const encoded = encodeMemoryFactContributionPayload(payload());
    expect(() =>
      decodeMemoryFactContributionPayload({ ...encoded, payloadSha256: '0'.repeat(64) }),
    ).toThrow('memory_fact_contribution_integrity_invalid');

    const parsed = JSON.parse(encoded.payloadJson) as Record<string, unknown>;
    const nonCanonicalJson = JSON.stringify({
      input: parsed.input,
      version: 1,
      operation: parsed.operation,
      applicability: parsed.applicability,
    });
    expect(() =>
      decodeMemoryFactContributionPayload({
        payloadVersion: 1,
        payloadJson: nonCanonicalJson,
        payloadSha256: sha256HexUtf8(nonCanonicalJson),
        payloadByteLength: new TextEncoder().encode(nonCanonicalJson).byteLength,
      }),
    ).toThrow('memory_fact_contribution_payload_invalid');

    expect(() =>
      encodeMemoryFactContributionPayload({ ...payload(), unexpected: true } as never),
    ).toThrow('memory_fact_contribution_payload_invalid');
    expect(() =>
      encodeMemoryFactContributionPayload({
        ...payload(),
        input: { ...payload().input, objectText: 'x'.repeat(16 * 1024 + 1) },
      }),
    ).toThrow('memory_fact_contribution_payload_invalid');
  });

  it('seals an exact replacement target without accepting legacy or broad supersession shapes', () => {
    const exactReplacement: MemoryFactContributionPayloadV1 = {
      ...payload(),
      operation: { kind: 'exact_replacement', expectedCurrentFactId: 'fact-predecessor' },
    };

    expect(
      decodeMemoryFactContributionPayload(encodeMemoryFactContributionPayload(exactReplacement)),
    ).toEqual(exactReplacement);
    expect(() =>
      encodeMemoryFactContributionPayload({
        ...exactReplacement,
        input: { ...exactReplacement.input, supersedePrior: true },
      }),
    ).toThrow('memory_fact_contribution_payload_invalid');
    expect(() =>
      encodeMemoryFactContributionPayload({
        ...payload(),
        operation: { kind: 'exact_replacement' },
      } as never),
    ).toThrow('memory_fact_contribution_payload_invalid');
    expect(() =>
      encodeMemoryFactContributionPayload({
        ...payload(),
        operation: { kind: 'record', expectedCurrentFactId: 'fact-predecessor' },
      } as never),
    ).toThrow('memory_fact_contribution_payload_invalid');
  });

  it('normalizes the exact source scope and multiple aliases without repairing identities', () => {
    const scope = normalizeMemoryFactContributionSourceScope({
      memoryOwnerId: 'vault-owner',
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      taskId: null,
    });
    expect(scope.taskId).toBe('');
    expect(
      normalizeMemoryFactContributionSourceAliases([
        { sourceKind: 'turn', sourceId: 'assistant-1' },
        { sourceKind: 'message', sourceId: 'user-1' },
        { sourceKind: 'run', sourceId: 'run-1' },
        { sourceKind: 'message', sourceId: 'user-1' },
      ]),
    ).toEqual([
      { sourceKind: 'message', sourceId: 'user-1' },
      { sourceKind: 'run', sourceId: 'run-1' },
      { sourceKind: 'turn', sourceId: 'assistant-1' },
    ]);
    expect(() =>
      normalizeMemoryFactContributionSourceScope({
        ...scope,
        sourceThreadId: ' thread-1',
      }),
    ).toThrow('memory_fact_contribution_thread_id_invalid');
  });

  it('orders opaque mixed-script source IDs by ECMAScript ordinal order', () => {
    expect(
      normalizeMemoryFactContributionSourceAliases([
        { sourceKind: 'message', sourceId: 'β' },
        { sourceKind: 'message', sourceId: 'ä' },
        { sourceKind: 'message', sourceId: 'a' },
        { sourceKind: 'message', sourceId: '消息' },
        { sourceKind: 'message', sourceId: 'Z' },
      ]).map((alias) => alias.sourceId),
    ).toEqual(['Z', 'a', 'ä', 'β', '消息']);
  });

  it('uses the unique causal producer event for idempotent contribution identity', () => {
    const scope = normalizeMemoryFactContributionSourceScope({
      memoryOwnerId: 'vault-owner',
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      taskId: 'task-1',
    });
    const firstProducer = requireMemoryFactContributionProducerIdentity({
      producerId: 'turn_structural',
      producerEventId: 'assistant-1:fact:0',
    });
    const secondProducer = requireMemoryFactContributionProducerIdentity({
      producerId: 'turn_structural',
      producerEventId: 'assistant-2:fact:0',
    });
    const first = buildMemoryFactContributionId({
      scope,
      producer: firstProducer,
    });

    expect(buildMemoryFactContributionId({ scope, producer: firstProducer })).toBe(first);
    expect(buildMemoryFactContributionId({ scope, producer: secondProducer })).not.toBe(first);
    expect(() =>
      requireMemoryFactContributionProducerIdentity({
        producerId: 'turn structural',
        producerEventId: 'assistant-1:fact:0',
      }),
    ).toThrow('memory_fact_contribution_producer_id_invalid');
  });
});

function equivalentPayload(): MemoryFactContributionPayloadV1 {
  return payload({ a: 1, nested: { first: 'value', second: true }, z: 3 });
}
