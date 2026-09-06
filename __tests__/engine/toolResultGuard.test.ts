// ---------------------------------------------------------------------------
// Tests — Tool Result Guard
// ---------------------------------------------------------------------------

import {
  truncateToolResult,
  getToolResultCharBudget,
  enforceToolResultBudget,
  compactToolResults,
  HARD_MAX_TOOL_RESULT_CHARS,
  SINGLE_TOOL_RESULT_CONTEXT_SHARE,
  MIN_KEEP_CHARS,
  TOOL_RESULT_CHARS_PER_TOKEN,
  COMPACTION_PLACEHOLDER,
} from '../../src/engine/toolResultGuard';
import type { Message } from '../../src/types/message';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
  startsOnGraphemeBoundary,
} from '../helpers/graphemeTestFixtures';

const makeToolMsg = (id: string, content: string): Message => ({
  id,
  role: 'tool',
  content,
  toolCallId: id,
  timestamp: Date.now(),
});

const makeUserMsg = (id: string, content: string): Message => ({
  id,
  role: 'user',
  content,
  timestamp: Date.now(),
});

describe('truncateToolResult', () => {
  it('returns short results unchanged', () => {
    const result = 'Hello world';
    expect(truncateToolResult(result)).toBe(result);
  });

  it('truncates results exceeding maxChars', () => {
    const result = 'A'.repeat(10_000);
    const truncated = truncateToolResult(result, 5000);
    expect(truncated.length).toBeLessThanOrEqual(5000);
    expect(truncated).toContain('[truncated: output exceeded context limit]');
  });

  it('keeps head and tail portions', () => {
    const result = 'HEAD' + 'X'.repeat(10_000) + 'TAIL';
    const truncated = truncateToolResult(result, 5000);
    expect(truncated.startsWith('HEAD')).toBe(true);
    expect(truncated.endsWith('TAIL')).toBe(true);
  });

  it('respects MIN_KEEP_CHARS floor', () => {
    const result = 'A'.repeat(10_000);
    const truncated = truncateToolResult(result, 100);
    // Should keep at least MIN_KEEP_CHARS
    expect(truncated.length).toBeGreaterThanOrEqual(MIN_KEEP_CHARS);
  });

  it('handles empty string', () => {
    expect(truncateToolResult('')).toBe('');
  });

  it('recalculates tail size when head is adjusted for newline boundary', () => {
    // Create a result with newlines where head will snap to a newline.
    // MIN_KEEP_CHARS = 1200, so use a limit above that.
    const maxChars = 2000;
    const headLines = 'Line1\nLine2\nLine3\n';
    const middleFiller = 'X'.repeat(8000);
    const tailContent = 'TAIL_END';
    const result = headLines + middleFiller + tailContent;
    const truncated = truncateToolResult(result, maxChars);

    // head + tail + truncation notice should fit within the limit
    expect(truncated.length).toBeLessThanOrEqual(maxChars);
    // And the result should still contain the tail
    expect(truncated.endsWith(tailContent)).toBe(true);
  });

  it('uses HARD_MAX_TOOL_RESULT_CHARS as default limit', () => {
    // A string under the hard max should pass through
    const result = 'A'.repeat(1000);
    expect(truncateToolResult(result)).toBe(result);
  });
});

describe('getToolResultCharBudget', () => {
  it('computes budget from context window', () => {
    // Kavi: contextWindowTokens * TOOL_RESULT_CHARS_PER_TOKEN * SINGLE_SHARE
    const budget = getToolResultCharBudget(128_000);
    expect(budget).toBe(
      Math.min(
        Math.floor(128_000 * TOOL_RESULT_CHARS_PER_TOKEN * SINGLE_TOOL_RESULT_CONTEXT_SHARE),
        HARD_MAX_TOOL_RESULT_CHARS,
      ),
    );
  });

  it('does not exceed HARD_MAX_TOOL_RESULT_CHARS', () => {
    const budget = getToolResultCharBudget(1_000_000);
    expect(budget).toBeLessThanOrEqual(HARD_MAX_TOOL_RESULT_CHARS);
  });

  it('handles small context windows', () => {
    const budget = getToolResultCharBudget(4000);
    expect(budget).toBeGreaterThan(0);
  });
});

describe('enforceToolResultBudget', () => {
  it('passes through small results', () => {
    const result = 'small result';
    expect(enforceToolResultBudget(result, 128_000)).toBe(result);
  });

  it('truncates large results', () => {
    const result = 'A'.repeat(500_000);
    const truncated = enforceToolResultBudget(result, 128_000);
    expect(truncated.length).toBeLessThan(result.length);
  });

  it('compacts large JSON arrays into summarized structures', () => {
    const result = JSON.stringify({
      status: 'ok',
      items: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        path: `src/file-${i + 1}.ts`,
        content: 'x'.repeat(200),
      })),
    });

    const compacted = enforceToolResultBudget(result, 4000);
    expect(compacted).toContain('"count": 20');
    expect(compacted).toContain('firstItems');
    expect(compacted).toContain('lastItems');
  });

  // Regression test — a duplicate grapheme-safety migration subtracted the
  // "… (N chars omitted)" suffix's length from the nested scalar preview
  // budget (240 chars for a first-level object field) before truncating, so
  // the kept content shrank by the suffix's length. The pre-migration
  // behaviour kept the full budget's worth of content and appended the
  // suffix after it (an unbounded total), and callers pass this exact
  // budget expecting that much content back.
  it('keeps the full nested scalar preview budget as content, not shrunk by the suffix length', () => {
    const summary = 'A'.repeat(2000);
    const result = JSON.stringify({ summary, filler: 'x'.repeat(20_000) });

    const compacted = enforceToolResultBudget(result, 4000);
    const parsed = JSON.parse(compacted);
    const summaryContent = String(parsed.summary).split('… (')[0];

    expect(summaryContent).toBe('A'.repeat(240));
  });

  it('preserves structured summary and failureLogs when compacting large JSON', () => {
    const result = JSON.stringify({
      summary:
        'Workflow workflow-run-77: FAILURE (FAILURE). Build / Install Dependencies: npm ERR! 404 @kavi/private-package not found | Command failed with exit code 1',
      status: 'ok',
      projectId: 'expo-project-1',
      projectName: 'Kavi',
      mode: 'eas-workflow',
      workflowRun: {
        id: 'workflow-run-77',
        status: 'FAILURE',
        conclusion: 'FAILURE',
        url: 'https://expo.dev/workflows/workflow-run-77',
      },
      jobs: Array.from({ length: 8 }, (_, i) => ({
        id: `job-${i + 1}`,
        name: `Job ${i + 1}`,
        status: i === 0 ? 'FAILURE' : 'COMPLETED',
        steps: Array.from({ length: 8 }, (__, stepIndex) => ({
          number: stepIndex + 1,
          name: `Step ${stepIndex + 1}`,
          status: stepIndex === 0 ? 'FAILURE' : 'COMPLETED',
          conclusion: stepIndex === 0 ? 'failure' : 'success',
          log: 'x'.repeat(400),
        })),
      })),
      failureLogs: Array.from({ length: 6 }, (_, i) => ({
        source: `Build / Phase ${i + 1}`,
        excerpt: [
          'npm ci',
          'npm ERR! 404 @kavi/private-package not found',
          'Command failed with exit code 1',
          'Stack trace line',
          'Another long line',
        ].join('\n'),
      })),
      guidance: 'Inspect failure logs first and fix dependency installation before retrying.',
    });

    const compacted = enforceToolResultBudget(result, 4000);
    expect(compacted).toContain('Workflow workflow-run-77: FAILURE');
    expect(compacted).toContain('@kavi/private-package not found');
    expect(compacted).not.toContain('failureSummary');
  });
});

describe('compactToolResults', () => {
  it('returns messages unchanged when under budget', () => {
    const msgs: Message[] = [makeUserMsg('u1', 'hello'), makeToolMsg('t1', 'small result')];
    const result = compactToolResults(msgs, 128_000);
    expect(result).toEqual(msgs);
  });

  it('replaces oldest tool messages with placeholder when over budget', () => {
    // Create a scenario where total content exceeds the context headroom budget
    // 4000 tokens * 4 chars/token * 0.75 headroom = 12000 chars budget
    // We make total content > 12000 to trigger compaction
    const oldTool = makeToolMsg('t1', 'O'.repeat(8000));
    const newTool = makeToolMsg('t2', 'N'.repeat(8000));
    const msgs: Message[] = [
      makeUserMsg('u1', 'hello'),
      oldTool,
      makeUserMsg('u2', 'more'),
      newTool,
    ];

    const result = compactToolResults(msgs, 4000);

    // Old tool should be replaced with a summarized placeholder, not dropped entirely.
    const oldContent = result.find((m) => m.id === 't1')!.content;
    expect(oldContent.startsWith(COMPACTION_PLACEHOLDER)).toBe(true);
    expect(oldContent).toContain('Summary:');
    expect(oldContent).toContain('Do not retry only because it was compacted');
  });

  it('preserves the key summary when compacting structured tool output', () => {
    const oldTool = makeToolMsg(
      't1',
      JSON.stringify({
        summary: 'Workflow failed during dependency installation.',
        failureLogs: [
          { source: 'Install', excerpt: 'npm ERR! 404 @kavi/private-package not found' },
        ],
      }),
    );
    const newTool = makeToolMsg('t2', 'N'.repeat(8000));
    const msgs: Message[] = [
      makeUserMsg('u1', 'hello'),
      oldTool,
      makeUserMsg('u2', 'more'),
      newTool,
    ];

    const result = compactToolResults(msgs, 4000);
    const oldContent = result.find((m) => m.id === 't1')!.content;
    expect(oldContent).toContain('Workflow failed during dependency installation.');
  });

  it('preserves non-tool messages', () => {
    const msgs: Message[] = [
      makeUserMsg('u1', 'A'.repeat(10_000)),
      makeToolMsg('t1', 'B'.repeat(10_000)),
    ];
    const result = compactToolResults(msgs, 4000);
    const userMsg = result.find((m) => m.id === 'u1')!;
    expect(userMsg.content).toBe('A'.repeat(10_000));
  });
});

describe('truncateToolResult — head/tail seam grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} at the head cut`, () => {
      const limit = MIN_KEEP_CHARS;
      const headBoundary = Math.floor(limit * 0.7);
      const value = `${buildBoundaryStraddlingText(headBoundary, cluster, 0)}${'m'.repeat(limit * 3)}${'t'.repeat(200)}`;

      const result = truncateToolResult(value, limit);
      expectGraphemeSafe(result);
      // result is `${head}\n[truncated: output exceeded context limit]${tail}`.
      const [headPart] = result.split('[truncated: output exceeded context limit]');
      const head = (headPart ?? '').slice(0, -1); // strip the notice's leading '\n'
      expect(endsOnGraphemeBoundary(value, head)).toBe(true);
    });

    it(`never splits ${name} at the tail cut`, () => {
      const limit = MIN_KEEP_CHARS;
      const tailBoundary = Math.floor(limit * 0.3);
      const value = `${'h'.repeat(200)}${'m'.repeat(limit * 3)}${buildBoundaryStraddlingText(tailBoundary, cluster, 0)}`;

      const result = truncateToolResult(value, limit);
      expectGraphemeSafe(result);
      // result is `${head}\n[truncated: output exceeded context limit]${tail}`.
      const parts = result.split('[truncated: output exceeded context limit]');
      const tail = parts[parts.length - 1] ?? '';
      expect(startsOnGraphemeBoundary(value, tail)).toBe(true);
    });
  }
});

describe('enforceToolResultBudget — structured scalar truncation grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the top-level scalar preview budget`, () => {
      const value = buildBoundaryStraddlingText(600, cluster, 200);
      const oversized = JSON.stringify({
        summary: value,
        filler: 'x'.repeat(20_000),
      });

      const result = enforceToolResultBudget(oversized, 1000);
      const parsed = JSON.parse(result);
      const summary = String(parsed.summary ?? '');
      expectGraphemeSafe(summary);
      // summary is truncateScalar's cut plus a dynamic-length
      // `… (N chars omitted)` suffix — strip it to recover the underlying cut.
      const cutText = summary.replace(/… \(\d+ chars omitted\)$/, '');
      expect(endsOnGraphemeBoundary(value, cutText)).toBe(true);
    });
  }
});
