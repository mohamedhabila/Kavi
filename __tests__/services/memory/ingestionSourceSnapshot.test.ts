import {
  decodeIngestionSourceSnapshot,
  encodeIngestionSourceSnapshot,
  INGESTION_SOURCE_SNAPSHOT_LIMITS,
  type EncodedIngestionSourceSnapshot,
} from '../../../src/services/memory/ingestionSourceSnapshot';
import type { Message } from '../../../src/types/message';
import { sha256HexUtf8 } from '../../../src/utils/sha256';

function sourceMessages(): Message[] {
  return [
    {
      id: 'prior-user',
      role: 'user',
      content: 'private prior turn content must not be captured',
      timestamp: 1,
    },
    {
      id: 'prior-assistant',
      role: 'assistant',
      content: 'prior answer',
      timestamp: 2,
    },
    {
      id: 'current-user',
      role: 'user',
      content: 'Please update the project plan.',
      enrichedContent: 'Please update the project plan with the attached brief.',
      reasoning: 'user-side memory annotation',
      timestamp: 3,
      attachments: [
        {
          id: 'attachment-secret',
          type: 'file',
          uri: 'file:///private/raw-attachment.txt',
          name: 'raw-attachment.txt',
          mimeType: 'text/plain',
          size: 42,
          base64: 'raw-attachment-base64-secret',
          workspacePath: '/private/workspace/raw-attachment.txt',
          transcript: 'raw attachment transcript secret',
        },
      ],
      providerReplay: {
        openaiResponseId: 'provider-replay-secret',
        openaiResponseOutput: [{ private: 'provider-output-secret' }],
      },
      effectId: 'confetti',
    },
    {
      id: 'assistant-tool-call',
      role: 'assistant',
      content: '',
      timestamp: 4,
      toolCalls: [
        {
          id: 'tool-call-1',
          name: 'write_file',
          arguments: '{"path":"/project/plan.md"}',
          status: 'completed',
          progressText: 'Writing plan',
          result: '{"ok":true}',
          error: '',
          raw: { private: 'provider-tool-raw-secret' },
          effectReceipts: [{ private: 'effect-receipt-secret' } as never],
          startedAt: 4,
          updatedAt: 5,
          completedAt: 6,
        },
      ],
      assistantMetadata: {
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'tool_calls',
      },
    },
    {
      id: 'tool-result-1',
      role: 'tool',
      content: '{"ok":true}',
      toolCallId: 'tool-call-1',
      timestamp: 5,
    },
    {
      id: 'final-assistant',
      role: 'assistant',
      content: 'The plan is updated.',
      reasoning: 'final answer reasoning',
      timestamp: 6,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        terminalReason: 'completed',
        memoryRetrievalEventId: 'retrieval_event_private_trace',
      },
      providerReplay: {
        anthropicBlocks: [{ private: 'anthropic-replay-secret' }],
      },
      subAgentEvent: { private: 'sub-agent-snapshot-secret' } as never,
    },
  ];
}

function encode(messages: readonly Message[] = sourceMessages()): EncodedIngestionSourceSnapshot {
  return encodeIngestionSourceSnapshot({
    messages,
    sourceStartMessageId: 'current-user',
    sourceEndMessageId: 'final-assistant',
    priorUserMessageId: 'prior-user',
    graphGoalEvidence: ['write_file:path=/project/plan.md', '{"sourceRunId":"run-1"}'],
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

function resealPayload(payload: unknown): EncodedIngestionSourceSnapshot {
  const payloadJson = JSON.stringify(canonicalize(payload));
  return {
    snapshotVersion: 1,
    payloadJson,
    payloadSha256: sha256HexUtf8(payloadJson),
    payloadByteLength: new TextEncoder().encode(payloadJson).byteLength,
  };
}

describe('ingestion source snapshot codec', () => {
  it('preserves source identities and order while capturing only memory-consumed fields', () => {
    const encoded = encode();
    const decoded = decodeIngestionSourceSnapshot(encoded);

    expect(decoded).toMatchObject({
      version: 1,
      sourceStartMessageId: 'current-user',
      sourceEndMessageId: 'final-assistant',
      priorUserMessageId: 'prior-user',
      priorUserMessage: { id: 'prior-user', role: 'user' },
      graphGoalEvidence: ['write_file:path=/project/plan.md', '{"sourceRunId":"run-1"}'],
    });
    expect(decoded.turnMessages.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: 'current-user', role: 'user' },
      { id: 'assistant-tool-call', role: 'assistant' },
      { id: 'tool-result-1', role: 'tool' },
      { id: 'final-assistant', role: 'assistant' },
    ]);
    expect(decoded.turnMessages[0]).toMatchObject({
      id: 'current-user',
      content: 'Please update the project plan.',
      enrichedContent: 'Please update the project plan with the attached brief.',
      hasAttachments: true,
    });
    expect(decoded.turnMessages[1]?.toolCalls?.[0]).toEqual({
      id: 'tool-call-1',
      name: 'write_file',
      arguments: '{"path":"/project/plan.md"}',
      status: 'completed',
      result: '{"ok":true}',
      error: '',
    });
    expect(decoded.turnMessages[2]).toMatchObject({
      id: 'tool-result-1',
      toolCallId: 'tool-call-1',
      content: '{"ok":true}',
    });
    expect(decoded.turnMessages[3]?.assistantMetadata).toEqual({
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    });

    for (const excluded of [
      'private prior turn content',
      'raw-attachment-base64-secret',
      '/private/workspace/raw-attachment.txt',
      'raw attachment transcript secret',
      'provider-replay-secret',
      'provider-output-secret',
      'provider-tool-raw-secret',
      'effect-receipt-secret',
      'anthropic-replay-secret',
      'sub-agent-snapshot-secret',
      'retrieval_event_private_trace',
      'user-side memory annotation',
      'final answer reasoning',
      'Writing plan',
    ]) {
      expect(encoded.payloadJson).not.toContain(excluded);
    }
  });

  it('is canonical and hash-stable across changes to excluded replay and attachment payloads', () => {
    const firstMessages = sourceMessages();
    const secondMessages = sourceMessages();
    secondMessages[2] = {
      ...secondMessages[2]!,
      attachments: [
        {
          ...secondMessages[2]!.attachments![0]!,
          uri: 'file:///different-private-path',
          base64: 'different-private-bytes',
        },
      ],
      providerReplay: { openaiResponseId: 'different-provider-replay' },
    };
    secondMessages[3] = {
      ...secondMessages[3]!,
      toolCalls: [
        {
          ...secondMessages[3]!.toolCalls![0]!,
          raw: { changed: true },
          effectReceipts: [{ changed: true } as never],
        },
      ],
    };

    const first = encode(firstMessages);
    const second = encode(secondMessages);
    expect(second).toEqual(first);
    expect(sha256HexUtf8(first.payloadJson)).toBe(first.payloadSha256);
    expect(new TextEncoder().encode(first.payloadJson).byteLength).toBe(first.payloadByteLength);
  });

  it('applies deterministic UTF-8 and envelope bounds while retaining anchors first', () => {
    const huge = '🧠'.repeat(12_000);
    const messages = sourceMessages();
    messages[2] = { ...messages[2]!, content: `user-start:${huge}:user-end` };
    messages[3] = {
      ...messages[3]!,
      content: `intermediate-start:${huge}:intermediate-end`,
      toolCalls: [
        {
          ...messages[3]!.toolCalls![0]!,
          arguments: `args-start:${huge}:args-end`,
          result: `result-start:${huge}:result-end`,
        },
      ],
    };
    messages[5] = { ...messages[5]!, content: `assistant-start:${huge}:assistant-end` };
    const evidence = Array.from(
      { length: INGESTION_SOURCE_SNAPSHOT_LIMITS.graphGoalEvidenceEntries + 9 },
      (_, index) => `evidence-${index}-start:${huge}:evidence-${index}-end`,
    );

    const first = encodeIngestionSourceSnapshot({
      messages,
      sourceStartMessageId: 'current-user',
      sourceEndMessageId: 'final-assistant',
      priorUserMessageId: 'prior-user',
      graphGoalEvidence: evidence,
    });
    const second = encodeIngestionSourceSnapshot({
      messages,
      sourceStartMessageId: 'current-user',
      sourceEndMessageId: 'final-assistant',
      priorUserMessageId: 'prior-user',
      graphGoalEvidence: evidence,
    });
    const decoded = decodeIngestionSourceSnapshot(first);

    expect(second).toEqual(first);
    expect(first.payloadByteLength).toBeLessThanOrEqual(
      INGESTION_SOURCE_SNAPSHOT_LIMITS.payloadBytes,
    );
    expect(decoded.graphGoalEvidence).toHaveLength(
      INGESTION_SOURCE_SNAPSHOT_LIMITS.graphGoalEvidenceEntries,
    );
    expect(decoded.graphGoalEvidence[0]).toContain('evidence-9-start');
    expect(decoded.truncation.graphGoalEvidenceEntries).toBe(9);
    expect(decoded.truncation.messageTextFields).toBeGreaterThan(0);
    expect(decoded.truncation.toolTextFields).toBeGreaterThan(0);
    expect(decoded.truncation.graphGoalEvidenceFields).toBeGreaterThan(0);
    expect(decoded.truncation.anchorTextByteLimit).toBeGreaterThanOrEqual(
      decoded.truncation.supplementalTextByteLimit,
    );
    expect(decoded.turnMessages[0]?.content).toContain('user-start');
    expect(decoded.turnMessages.at(-1)?.content).toContain('assistant-start');
    expect(first.payloadJson).not.toContain('\ufffd');
  });

  it('rejects tampered integrity, non-canonical payloads, and forbidden fields', () => {
    const encoded = encode();
    expect(() =>
      decodeIngestionSourceSnapshot({
        ...encoded,
        payloadJson: encoded.payloadJson.replace('The plan is updated.', 'The plan was changed.'),
      }),
    ).toThrow('memory_ingestion_source_snapshot_integrity_invalid');
    expect(() =>
      decodeIngestionSourceSnapshot({
        ...encoded,
        payloadByteLength: encoded.payloadByteLength + 1,
      }),
    ).toThrow('memory_ingestion_source_snapshot_integrity_invalid');

    const parsed = JSON.parse(encoded.payloadJson) as {
      turnMessages: Array<Record<string, unknown>>;
    };
    parsed.turnMessages[0]!.providerReplay = { private: true };
    expect(() => decodeIngestionSourceSnapshot(resealPayload(parsed))).toThrow(
      'memory_ingestion_source_snapshot_payload_invalid',
    );

    const nonCanonical = JSON.stringify(JSON.parse(encoded.payloadJson), null, 2);
    expect(() =>
      decodeIngestionSourceSnapshot({
        snapshotVersion: 1,
        payloadJson: nonCanonical,
        payloadSha256: sha256HexUtf8(nonCanonical),
        payloadByteLength: new TextEncoder().encode(nonCanonical).byteLength,
      }),
    ).toThrow('memory_ingestion_source_snapshot_payload_invalid');
  });

  it('fails closed for mismatched, ambiguous, or reordered source identity', () => {
    expect(() =>
      encodeIngestionSourceSnapshot({
        messages: sourceMessages(),
        sourceStartMessageId: 'current-user',
        sourceEndMessageId: 'final-assistant',
        priorUserMessageId: null,
      }),
    ).toThrow('memory_ingestion_source_snapshot_prior_user_mismatch');

    const duplicated = sourceMessages();
    duplicated.splice(4, 0, { ...duplicated[4]!, id: 'current-user' });
    expect(() => encode(duplicated)).toThrow();

    const reordered = sourceMessages();
    const final = reordered.pop()!;
    reordered.splice(1, 0, final);
    expect(() => encode(reordered)).toThrow(
      'memory_ingestion_source_snapshot_source_start_unavailable',
    );

    const laterUser = sourceMessages();
    laterUser.splice(-1, 0, {
      id: 'later-user',
      role: 'user',
      content: 'This must become the sealed source start.',
      timestamp: 5,
    });
    expect(() => encode(laterUser)).toThrow('memory_ingestion_source_snapshot_order_invalid');

    const incomplete = sourceMessages();
    incomplete[incomplete.length - 1] = {
      ...incomplete.at(-1)!,
      assistantMetadata: { kind: 'final', completionStatus: 'incomplete' },
    };
    expect(() => encode(incomplete)).toThrow(
      'memory_ingestion_source_snapshot_source_end_unavailable',
    );
  });
});
