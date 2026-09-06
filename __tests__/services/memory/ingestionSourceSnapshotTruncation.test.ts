import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import type { Message } from '../../../src/types/message';
import type { IngestionSourceSnapshotV1 } from '../../../src/services/memory/ingestionSourceSnapshot';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

function decode(encoded: ReturnType<typeof encodeIngestionSourceSnapshot>): IngestionSourceSnapshotV1 {
  return JSON.parse(encoded.payloadJson) as IngestionSourceSnapshotV1;
}

describe('encodeIngestionSourceSnapshot UTF-8 byte-budget truncation', () => {
  it('never splits a grapheme cluster when the 16KB anchor text-field cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      // 16384 bytes is the largest INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS
      // entry; repeating the probe throughout a longer message guarantees an
      // occurrence straddles whichever byte budget the encoder settles on.
      const content = `${'a'.repeat(16_000)}${probe.repeat(200)}`;
      const messages: Message[] = [
        { id: 'user-1', role: 'user', content: 'Deterministic test request.', timestamp: 1 },
        {
          id: 'assistant-1',
          role: 'assistant',
          content,
          timestamp: 2,
          assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
        },
      ];

      const encoded = encodeIngestionSourceSnapshot({
        messages,
        sourceStartMessageId: 'user-1',
        sourceEndMessageId: 'assistant-1',
        priorUserMessageId: null,
      });
      const payload = decode(encoded);
      const assistantMessage = payload.turnMessages.find((message) => message.id === 'assistant-1');
      expect(assistantMessage?.content.length).toBeGreaterThan(0);
      expectGraphemeSafe(assistantMessage?.content ?? '');
    }
  });
});
