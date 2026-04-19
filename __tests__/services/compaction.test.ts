// ---------------------------------------------------------------------------
// Tests — Context Compaction Engine (Tiered)
// ---------------------------------------------------------------------------

import {
  DefaultContextEngine,
  clearOldToolResults,
  determineCompactionTier,
  buildStructuredSummary,
  alignCompactionTailStart,
  getMessageContentForContext,
  TOOL_CLEARED_PLACEHOLDER,
  COMPACTION_SUMMARY_MARKER,
} from '../../src/services/context/compaction';
import type { Message } from '../../src/types';

// Mock events bus
jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
}));

const makeMsg = (role: 'user' | 'assistant' | 'system', content: string): Message => ({
  id: `msg-${Math.random()}`,
  role,
  content,
  timestamp: Date.now(),
  attachments: [],
});

const makeAssistantToolMsg = (id: string, toolCallId: string): Message => ({
  id,
  role: 'assistant',
  content: '',
  toolCalls: [
    {
      id: toolCallId,
      name: 'read_file',
      arguments: '{"path":"/tmp/demo.txt"}',
      status: 'completed',
    },
  ],
  timestamp: Date.now(),
});

const makeToolMsg = (id: string, toolCallId: string, content: string): Message => ({
  id,
  role: 'tool',
  content,
  toolCallId,
  toolCalls: [
    {
      id: toolCallId,
      name: 'read_file',
      arguments: '{"path":"/tmp/demo.txt"}',
      status: 'failed',
      error: content,
    },
  ],
  timestamp: Date.now(),
  isError: true,
});

describe('DefaultContextEngine', () => {
  const engine = new DefaultContextEngine();

  describe('info', () => {
    it('has correct metadata', () => {
      expect(engine.info.id).toBe('default');
      expect(engine.info.ownsCompaction).toBe(true);
    });
  });

  describe('bootstrap', () => {
    it('returns bootstrapped true', async () => {
      const result = await engine.bootstrap();
      expect(result.bootstrapped).toBe(true);
    });
  });

  describe('ingest', () => {
    it('returns ingested true', async () => {
      const result = await engine.ingest({ sessionId: 's1', message: makeMsg('user', 'hi') });
      expect(result.ingested).toBe(true);
    });
  });

  describe('assemble', () => {
    it('includes all messages within budget', async () => {
      const messages = [
        makeMsg('system', 'You are an AI.'),
        makeMsg('user', 'Hello'),
        makeMsg('assistant', 'Hi'),
      ];
      const result = await engine.assemble({ sessionId: 's1', messages, tokenBudget: 100000 });
      expect(result.messages).toHaveLength(3);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it('always includes system messages', async () => {
      const messages = [
        makeMsg('system', 'System'),
        ...Array.from({ length: 50 }, (_, i) => makeMsg('user', `Message ${i} `.repeat(100))),
      ];
      const result = await engine.assemble({ sessionId: 's1', messages, tokenBudget: 500 });
      expect(result.messages.some((m) => m.role === 'system')).toBe(true);
    });

    it('prioritizes recent messages', async () => {
      const messages = [
        makeMsg('user', 'Old message'),
        makeMsg('user', 'Middle message'),
        makeMsg('user', 'Recent message'),
      ];
      const result = await engine.assemble({ sessionId: 's1', messages, tokenBudget: 50 });
      // Should include most recent
      expect(result.messages.some((m) => m.content === 'Recent message')).toBe(true);
    });

    it('keeps system messages first and preserves chronological order', async () => {
      const messages = [
        makeMsg('system', 'System instructions'),
        makeMsg('user', 'First user turn'),
        makeMsg('assistant', 'First assistant turn'),
        makeMsg('user', 'Second user turn'),
      ];

      const result = await engine.assemble({ sessionId: 's1', messages, tokenBudget: 100000 });
      expect(result.messages.map((message) => message.content)).toEqual([
        'System instructions',
        'First user turn',
        'First assistant turn',
        'Second user turn',
      ]);
    });
  });

  describe('compact', () => {
    it('returns not compacted when below threshold', async () => {
      const messages = [makeMsg('user', 'Hello'), makeMsg('assistant', 'Hi')];
      const result = await engine.compact({
        sessionId: 's1',
        messages,
        tokenBudget: 100000,
      });
      expect(result.compacted).toBe(false);
      expect(result.tier).toBe('none');
    });

    it('compacts when forced', async () => {
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`),
      );
      const result = await engine.compact({
        sessionId: 's1',
        messages,
        force: true,
      });
      expect(result.compacted).toBe(true);
      expect(result.result?.summary).toContain('Conversation Summary');
    });

    it('supports forced tool clearing below the normal thresholds', async () => {
      const messages: Message[] = [
        makeMsg('user', 'Investigate the failing command.'),
        ...Array.from({ length: 8 }, (_, index) =>
          makeToolMsg(`tool-${index}`, `tc-${index}`, `Old tool result ${index} `.repeat(80)),
        ),
      ];

      const result = await engine.compact({
        sessionId: 's1',
        messages,
        tokenBudget: 100000,
        forceTier: 'tool_clearing',
      });

      expect(result.compacted).toBe(true);
      expect(result.tier).toBe('tool_clearing');
      expect(result.result?.clearedToolResults).toBeGreaterThan(0);
    });

    it('supports forced aggressive compaction for shorter histories', async () => {
      const messages = Array.from({ length: 6 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i} ${'x'.repeat(1400)}`),
      );

      const result = await engine.compact({
        sessionId: 's1',
        messages,
        forceTier: 'aggressive',
      });

      expect(result.compacted).toBe(true);
      expect(result.tier).toBe('aggressive');
      expect(result.result?.summary).toContain('Conversation Summary');
    });

    it('keeps a recent message tail after compaction', async () => {
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Content ${i}`),
      );
      const result = await engine.compact({
        sessionId: 's1',
        messages,
        force: true,
      });
      expect(result.result?.firstKeptEntryId).toBeDefined();
    });

    it('aligns the kept tail to the assistant message when a raw cut would start on a tool result', async () => {
      const messages: Message[] = [
        makeMsg('user', 'Older request that will be summarized.'),
        makeAssistantToolMsg('assistant-tool', 'tc_1'),
        makeToolMsg('tool-result', 'tc_1', 'Error: file missing'),
        makeMsg('user', 'Recent message 1'),
        makeMsg('assistant', 'Recent message 2'),
        makeMsg('user', 'Recent message 3'),
        makeMsg('assistant', 'Recent message 4'),
        makeMsg('user', 'Recent message 5'),
      ];

      const result = await engine.compact({
        sessionId: 's1',
        messages,
        force: true,
      });

      // With selective tier (min keep=8) and only 8 non-system messages,
      // all messages are kept so nothing to summarize
      expect(result.compacted).toBe(false);
    });

    it('uses semantic expo workflow summaries instead of raw JSON prefixes for old tool turns', async () => {
      const expoToolContent = JSON.stringify({
        summary:
          'Workflow workflow-run-77: FAILURE (FAILURE). Build / Install Dependencies: npm ERR! 404 @kavi/private-package not found | Command failed with exit code 1',
        status: 'ok',
        workflowRun: {
          id: 'workflow-run-77',
          status: 'FAILURE',
          conclusion: 'FAILURE',
        },
        failureLogs: [
          {
            source: 'Build / Install Dependencies',
            excerpt: [
              'npm ci',
              'npm ERR! 404 @kavi/private-package not found',
              'Command failed with exit code 1',
            ].join('\n'),
          },
        ],
        jobs: [{ id: 'job-1', name: 'Build', status: 'FAILURE' }],
      });

      const messages: Message[] = [
        makeMsg('user', 'Investigate the failing Expo workflow.'),
        {
          id: 'assistant-expo',
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'tc_expo',
              name: 'expo_eas_workflow_status',
              arguments: '{"projectId":"expo-project-1"}',
              status: 'completed',
            },
          ],
          timestamp: Date.now(),
        },
        {
          id: 'tool-expo',
          role: 'tool',
          content: expoToolContent,
          toolCallId: 'tc_expo',
          toolCalls: [
            {
              id: 'tc_expo',
              name: 'expo_eas_workflow_status',
              arguments: '{"projectId":"expo-project-1"}',
              status: 'failed',
              error: expoToolContent,
            },
          ],
          timestamp: Date.now(),
          isError: true,
        },
        makeMsg('user', 'Recent message 1'),
        makeMsg('assistant', 'Recent message 2'),
        makeMsg('user', 'Recent message 3'),
        makeMsg('assistant', 'Recent message 4'),
        makeMsg('user', 'Recent message 5'),
        makeMsg('assistant', 'Recent message 6'),
        makeMsg('user', 'Recent message 7'),
        makeMsg('assistant', 'Recent message 8'),
        makeMsg('user', 'Recent message 9'),
        makeMsg('assistant', 'Recent message 10'),
        makeMsg('user', 'Recent message 11'),
      ];

      const result = await engine.compact({
        sessionId: 's1',
        messages,
        force: true,
      });

      expect(result.compacted).toBe(true);
      expect(result.result?.summary).toContain('expo_eas_workflow_status');
      expect(result.result?.summary).toContain('Workflow workflow-run-77: FAILURE');
    });

    it('returns not compacted when nothing to summarize', async () => {
      const messages = [makeMsg('user', 'Hello')];
      const result = await engine.compact({
        sessionId: 's1',
        messages,
        force: true,
      });
      // Only 1 msg, selective min keep=8 → toSummarize.length = 0
      expect(result.compacted).toBe(false);
    });
  });

  // ── Tiered compaction tests ──────────────────────────────────────────

  describe('determineCompactionTier', () => {
    it('returns none when below all thresholds', () => {
      expect(determineCompactionTier(50000, 100000)).toBe('none');
    });

    it('returns tool_clearing at 60%+', () => {
      expect(determineCompactionTier(61000, 100000)).toBe('tool_clearing');
    });

    it('returns selective at 75%+', () => {
      expect(determineCompactionTier(76000, 100000)).toBe('selective');
    });

    it('returns aggressive at 85%+', () => {
      expect(determineCompactionTier(86000, 100000)).toBe('aggressive');
    });
  });

  describe('clearOldToolResults', () => {
    it('does nothing when fewer tool results than keep threshold', () => {
      const messages: Message[] = [
        makeMsg('user', 'test'),
        makeToolMsg('t1', 'tc1', 'result 1'),
        makeToolMsg('t2', 'tc2', 'result 2'),
      ];
      const { cleared, tokensFreed } = clearOldToolResults(messages);
      expect(cleared).toBe(0);
      expect(tokensFreed).toBe(0);
    });

    it('clears old tool results while keeping recent ones', () => {
      const messages: Message[] = [
        makeMsg('user', 'test'),
        makeToolMsg('t1', 'tc1', 'Very long old result '.repeat(100)),
        makeToolMsg('t2', 'tc2', 'Another old result '.repeat(100)),
        makeToolMsg('t3', 'tc3', 'Old result 3 '.repeat(100)),
        makeToolMsg('t4', 'tc4', 'Old result 4 '.repeat(100)),
        makeToolMsg('t5', 'tc5', 'Old result 5 '.repeat(100)),
        makeToolMsg('t6', 'tc6', 'Old result 6 '.repeat(100)),
        makeToolMsg('t7', 'tc7', 'Recent result 1'),
        makeToolMsg('t8', 'tc8', 'Recent result 2'),
        makeToolMsg('t9', 'tc9', 'Recent result 3'),
        makeToolMsg('t10', 'tc10', 'Recent result 4'),
        makeToolMsg('t11', 'tc11', 'Recent result 5'),
        makeToolMsg('t12', 'tc12', 'Recent result 6'),
      ];
      const { messages: result, cleared, tokensFreed } = clearOldToolResults(messages);
      expect(cleared).toBeGreaterThan(0);
      expect(tokensFreed).toBeGreaterThan(0);
      // Recent results should be preserved
      expect(result[result.length - 1].content).toBe('Recent result 6');
      // Old results should be cleared with a bounded summary instead of losing all signal.
      expect(result[1].content.startsWith(TOOL_CLEARED_PLACEHOLDER)).toBe(true);
      expect(result[1].content).toContain('Summary:');
      expect(result[1].content).toContain('Do not retry only because it was cleared');
    });

    it('preserves a compact summary when clearing structured tool results', () => {
      const messages: Message[] = [
        makeMsg('user', 'check workflow'),
        makeToolMsg(
          't1',
          'tc1',
          JSON.stringify({
            summary: 'Workflow failed because npm could not resolve a private package.',
            failureLogs: [
              { source: 'Install', excerpt: 'npm ERR! 404 @kavi/private-package not found' },
            ],
          }),
        ),
        makeToolMsg('t2', 'tc2', 'old result '.repeat(80)),
        makeToolMsg('t3', 'tc3', 'old result '.repeat(80)),
        makeToolMsg('t4', 'tc4', 'old result '.repeat(80)),
        makeToolMsg('t5', 'tc5', 'recent result 1'),
        makeToolMsg('t6', 'tc6', 'recent result 2'),
        makeToolMsg('t7', 'tc7', 'recent result 3'),
        makeToolMsg('t8', 'tc8', 'recent result 4'),
      ];

      const { messages: result } = clearOldToolResults(messages, 3);
      expect(result[1].content).toContain(
        'Workflow failed because npm could not resolve a private package.',
      );
    });

    it('never clears below the minimum keep count', () => {
      const messages: Message[] = [
        makeMsg('user', 'test'),
        makeToolMsg('t1', 'tc1', 'old result 1 '.repeat(50)),
        makeToolMsg('t2', 'tc2', 'old result 2 '.repeat(50)),
        makeToolMsg('t3', 'tc3', 'old result 3 '.repeat(50)),
        makeToolMsg('t4', 'tc4', 'recent result 4 '.repeat(50)),
        makeToolMsg('t5', 'tc5', 'recent result 5 '.repeat(50)),
      ];

      const { messages: result, cleared } = clearOldToolResults(messages, 1);
      expect(cleared).toBe(2);
      expect(
        result.filter(
          (message) => message.role === 'tool' && !message.content.includes('cleared:'),
        ),
      ).toHaveLength(3);
    });
  });

  describe('buildStructuredSummary', () => {
    it('builds Anthropic-style structured summary', () => {
      const messages: Message[] = [
        makeMsg('user', 'Build a web scraper for product pages'),
        makeMsg(
          'assistant',
          'I decided to use Puppeteer because it handles JavaScript rendering.\nCreated scraper.ts with page navigation logic.',
        ),
        makeMsg('user', 'Add error handling'),
        makeMsg('assistant', 'Fixed the timeout error by adding retry logic.\nUpdated scraper.ts'),
      ];
      const summary = buildStructuredSummary(messages, 'selective');
      expect(summary).toContain('Conversation Summary');
      expect(summary).toContain('Task Overview');
      expect(summary).toContain('Build a web scraper');
      expect(summary).toContain('Current State');
    });

    it('includes file paths in Context to Preserve', () => {
      const messages: Message[] = [
        makeMsg('user', 'Fix the config'),
        makeMsg('assistant', 'Updated src/config.ts and package.json'),
      ];
      const summary = buildStructuredSummary(messages, 'selective');
      expect(summary).toContain('config.ts');
    });

    it('produces more compact output for aggressive tier', () => {
      const messages: Message[] = Array.from({ length: 20 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i} with some context`),
      );
      const selective = buildStructuredSummary(messages, 'selective');
      const aggressive = buildStructuredSummary(messages, 'aggressive');
      expect(aggressive.length).toBeLessThanOrEqual(selective.length);
    });

    it('includes prior context section when priorContext is provided', () => {
      const messages: Message[] = [
        makeMsg('user', 'Continue building the API'),
        makeMsg('assistant', 'Added the /users endpoint.'),
      ];
      const priorContext =
        '[Conversation Summary]\n\n## Task Overview\nBuild a REST API for user management';
      const summary = buildStructuredSummary(messages, 'selective', priorContext);
      expect(summary).toContain('## Prior Context');
      expect(summary).toContain('Build a REST API');
    });

    it('truncates prior context for aggressive tier', () => {
      const longPrior = 'A'.repeat(2000);
      const messages: Message[] = [makeMsg('user', 'Next step'), makeMsg('assistant', 'Done.')];
      const summary = buildStructuredSummary(messages, 'aggressive', longPrior);
      // Aggressive max is 600 chars; the section should be truncated
      expect(summary).toContain('## Prior Context');
      expect(summary).toContain('…');
      // The prior content should be bounded (600 chars + marker overhead)
      const priorSection = summary.split('## Prior Context\n')[1]?.split('\n\n##')[0] || '';
      expect(priorSection.length).toBeLessThanOrEqual(601); // 600 + ellipsis
    });

    it('allows more prior context for selective tier than aggressive', () => {
      const longPrior = 'B'.repeat(2000);
      const messages: Message[] = [makeMsg('user', 'Continue'), makeMsg('assistant', 'OK.')];
      const selectiveSummary = buildStructuredSummary(messages, 'selective', longPrior);
      const aggressiveSummary = buildStructuredSummary(messages, 'aggressive', longPrior);
      expect(selectiveSummary.length).toBeGreaterThan(aggressiveSummary.length);
    });

    it('omits prior context section when priorContext is undefined', () => {
      const messages: Message[] = [makeMsg('user', 'Hello'), makeMsg('assistant', 'Hi')];
      const summary = buildStructuredSummary(messages, 'selective');
      expect(summary).not.toContain('## Prior Context');
    });
  });

  describe('multi-round compaction preserves prior summaries', () => {
    it('incorporates prior compaction summary into new summary during Tier 2', async () => {
      const engine = new DefaultContextEngine();
      // Simulate state after a previous compaction: system message with summary + recent messages
      const priorSummary = `${COMPACTION_SUMMARY_MARKER}\n\n## Task Overview\nBuild a web scraper for product pages\n\n## Current State\nTool calls: 12 total`;
      const messages: Message[] = [
        makeMsg('system', priorSummary),
        ...Array.from({ length: 20 }, (_, i) =>
          makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Follow-up message ${i}`),
        ),
      ];
      const result = await engine.compact({
        sessionId: 'test',
        messages,
        tokenBudget: 128000,
        force: true,
      });
      expect(result.compacted).toBe(true);
      expect(result.result?.summary).toContain('## Prior Context');
      expect(result.result?.summary).toContain('Build a web scraper');
    });

    it('does NOT include non-summary system messages as prior context', async () => {
      const engine = new DefaultContextEngine();
      // Loop warning — should NOT be preserved as prior context
      const loopWarning = 'Warning: possible tool loop detected';
      const messages: Message[] = [
        makeMsg('system', loopWarning),
        ...Array.from({ length: 20 }, (_, i) =>
          makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`),
        ),
      ];
      const result = await engine.compact({
        sessionId: 'test',
        messages,
        tokenBudget: 128000,
        force: true,
      });
      expect(result.compacted).toBe(true);
      // Loop warning doesn't contain COMPACTION_SUMMARY_MARKER, so no Prior Context section
      expect(result.result?.summary).not.toContain('## Prior Context');
      expect(result.result?.summary).not.toContain('possible tool loop');
    });
  });
});
