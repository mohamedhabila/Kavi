import { buildStructuredSummary } from '../../src/services/context/compactionSummary';
import { parseReadFileContinuationSummaryLine } from '../../src/utils/readFileContinuation';
import type { Message } from '../../src/types/message';

function makeMessage(role: Message['role'], content: string): Message {
  return { id: `${role}-${content}`, role, content, timestamp: 1 };
}

function makeReadChunkMessage(params: {
  id: string;
  path: string;
  sha256: string;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
  complete: boolean;
}): Message {
  const content = JSON.stringify({
    status: 'read_chunk',
    path: params.path,
    sha256: params.sha256,
    content: 'source text',
    offset: params.offset,
    nextOffset: params.nextOffset,
    totalChars: params.totalChars,
    complete: params.complete,
  });
  return {
    id: params.id,
    role: 'tool',
    content,
    toolCallId: `${params.id}-call`,
    toolCalls: [
      {
        id: `${params.id}-call`,
        name: 'read_file',
        arguments: JSON.stringify({ path: params.path, offset: params.offset }),
        status: 'completed',
      },
    ],
    timestamp: 1,
  };
}

function readContinuation(summary: string, path: string) {
  return summary
    .split('\n')
    .map(parseReadFileContinuationSummaryLine)
    .find((state) => state?.path === path);
}

describe('compaction summary continuity', () => {
  it('rolls prior summaries forward without recursive summary envelopes', () => {
    const initial = buildStructuredSummary(
      [
        makeMessage('user', 'Audit the attached project'),
        makeMessage('assistant', 'Started audit.'),
      ],
      'selective',
    );
    const second = buildStructuredSummary(
      [makeMessage('assistant', 'Reviewed the first module.')],
      'selective',
      initial,
    );
    const third = buildStructuredSummary(
      [makeMessage('assistant', 'Reviewed the second module.')],
      'selective',
      second,
    );

    expect(third.match(/\[Conversation Summary\]/g)).toHaveLength(1);
    expect(third.match(/^## Prior Context$/gm)).toHaveLength(1);
    expect(third).toContain('Audit the attached project');
    expect(third).toContain('Reviewed the second module');
  });

  it('preserves exact read_file continuation state across repeated compaction', () => {
    const toolMessage = makeReadChunkMessage({
      id: 'read-result',
      path: 'attachments/large-report.txt',
      sha256: 'a'.repeat(64),
      offset: 7_000,
      nextOffset: 14_000,
      totalChars: 28_000,
      complete: false,
    });
    const initial = buildStructuredSummary([toolMessage], 'selective');
    const next = buildStructuredSummary(
      [makeMessage('assistant', 'Continuing the audit.')],
      'selective',
      initial,
    );

    expect(next).toContain('## Tool Continuation State (code-owned)');
    expect(next).toContain('"path":"attachments/large-report.txt"');
    expect(next).toContain('"nextOffset":14000');
    expect(next).toContain('"complete":false');
    expect(next.match(/\[Conversation Summary\]/g)).toHaveLength(1);
  });

  it('does not regress a durable read offset when later compaction summarizes stale chunks', () => {
    const path = 'attachments/large-report.txt';
    const sha256 = 'a'.repeat(64);
    const initial = buildStructuredSummary(
      [
        makeReadChunkMessage({
          id: 'advanced-read',
          path,
          sha256,
          offset: 56_000,
          nextOffset: 63_000,
          totalChars: 147_000,
          complete: false,
        }),
      ],
      'selective',
    );
    const repeated = buildStructuredSummary(
      [
        makeReadChunkMessage({
          id: 'stale-read',
          path,
          sha256,
          offset: 7_000,
          nextOffset: 14_000,
          totalChars: 147_000,
          complete: false,
        }),
      ],
      'selective',
      initial,
    );

    expect(readContinuation(repeated, path)).toMatchObject({
      sha256,
      offset: 56_000,
      nextOffset: 63_000,
      complete: false,
    });
  });

  it('allows a changed file revision to restart continuation at a lower offset', () => {
    const path = 'attachments/large-report.txt';
    const initial = buildStructuredSummary(
      [
        makeReadChunkMessage({
          id: 'old-read',
          path,
          sha256: 'a'.repeat(64),
          offset: 56_000,
          nextOffset: 63_000,
          totalChars: 147_000,
          complete: false,
        }),
      ],
      'selective',
    );
    const changed = buildStructuredSummary(
      [
        makeReadChunkMessage({
          id: 'new-read',
          path,
          sha256: 'b'.repeat(64),
          offset: 0,
          nextOffset: 7_000,
          totalChars: 147_000,
          complete: false,
        }),
      ],
      'selective',
      initial,
    );

    expect(readContinuation(changed, path)).toMatchObject({
      sha256: 'b'.repeat(64),
      offset: 0,
      nextOffset: 7_000,
    });
  });
});
