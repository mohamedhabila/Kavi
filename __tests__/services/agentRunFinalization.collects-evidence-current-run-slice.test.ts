import type { Message } from '../../src/types/message';
import { summarizeFinalizationToolResultPreview } from '../../src/services/agents/finalizationText';
import { buildAgentRunCompletionFallbackOutput, canRecoverAgentRunFinalResponse, collectAgentRunFinalizationEvidence, hasVerifiedFinalizationEvidence, selectAgentRunDirectTerminalFinalOutput } from '../../src/services/agents/lifecycle/finalizePhase';

describe('agentRunFinalization', () => {
  it('collects evidence from the current run slice and summarizes tool results', () => {
    const messages: Message[] = [
      {
        id: 'user-old',
        role: 'user',
        content: 'Old turn',
        timestamp: 1,
      },
      {
        id: 'assistant-old',
        role: 'assistant',
        content: 'Old response',
        timestamp: 2,
      },
      {
        id: 'user-1',
        role: 'user',
        content: 'Audit the repository',
        timestamp: 3,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Launching a worker.',
        timestamp: 4,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'sessions_spawn',
            arguments: '{}',
            status: 'completed',
            result: JSON.stringify({ summary: 'Worker launched successfully.' }),
          },
        ],
      },
      {
        id: 'worker-1',
        role: 'assistant',
        content: 'Worker completed.',
        timestamp: 5,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: {
            sessionId: 'sub-1',
            parentConversationId: 'conv-1',
            depth: 1,
            startedAt: 4,
            updatedAt: 5,
            status: 'completed',
            sandboxPolicy: 'inherit',
            toolsUsed: ['read_file', 'write_file'],
            output: 'Repository audit complete. Patched the failing workflow.',
            activityLog: [
              { timestamp: 4, kind: 'tool', text: 'Using read_file: package.json' },
              { timestamp: 5, kind: 'result', text: 'read_file: package.json verified.' },
            ],
          },
        },
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({ output: 'Verified the patch and tests passed.' }),
        toolCallId: 'tc-verify',
        timestamp: 6,
        toolCalls: [
          {
            id: 'tc-verify',
            name: 'run_tests',
            arguments: '{}',
            status: 'completed',
          },
        ],
      },
    ];

    const evidence = collectAgentRunFinalizationEvidence(messages, 'user-1', 2);

    expect(evidence.originalPrompt).toBe('Audit the repository');
    expect(evidence.transcriptMessages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'worker-1',
      'tool-1',
    ]);
    expect(evidence.resultPreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: 'sessions_spawn',
          preview: 'Worker launched successfully.',
        }),
        expect.objectContaining({
          sourceName: 'sub-1',
          preview: 'Repository audit complete. Patched the failing workflow.',
        }),
        expect.objectContaining({
          sourceName: 'sub-1',
          preview: 'result: read_file: package.json verified.',
        }),
        expect.objectContaining({
          sourceName: 'run_tests',
          preview: 'Verified the patch and tests passed.',
        }),
      ]),
    );
    expect(evidence.lastSubstantiveResult).toContain('Verified the patch and tests passed.');
    expect(evidence.toolsUsed).toEqual(
      expect.arrayContaining(['sessions_spawn', 'read_file', 'write_file', 'run_tests']),
    );
    expect(evidence.hasIncompleteToolCalls).toBe(false);
  });
  it('merges live worker snapshots into finalization evidence when transcript worker events are missing', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Audit the repository',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Launching a worker.',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'sessions_spawn',
            arguments: '{}',
            status: 'completed',
            result: JSON.stringify({ status: 'running', sessionId: 'sub-1' }),
          },
        ],
      },
    ];

    const evidence = collectAgentRunFinalizationEvidence(messages, 'user-1', 1, {
      liveSubAgentSnapshots: [
        {
          sessionId: 'sub-1',
          parentConversationId: 'conv-1',
          depth: 1,
          startedAt: 2,
          updatedAt: 3,
          status: 'completed',
          sandboxPolicy: 'inherit',
          toolsUsed: ['file_edit'],
          output: 'Repository audit complete. Patched the failing workflow.',
        },
      ],
    });

    expect(evidence.resultPreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: 'sub-1',
          preview: 'Repository audit complete. Patched the failing workflow.',
        }),
      ]),
    );
    expect(evidence.lastSubstantiveResult).toContain(
      'Repository audit complete. Patched the failing workflow.',
    );
    expect(evidence.toolsUsed).toEqual(expect.arrayContaining(['sessions_spawn', 'file_edit']));
  });
  it('preserves the full run transcript for downstream pilot review instead of tail-cropping it', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Audit the repository',
        timestamp: 1,
      },
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `assistant-${index + 1}`,
        role: 'assistant' as const,
        content: `Assistant message ${index + 1}`,
        timestamp: index + 2,
      })),
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({ output: 'Verified the patch and tests passed.' }),
        toolCallId: 'tc-verify',
        timestamp: 40,
      },
    ];

    const evidence = collectAgentRunFinalizationEvidence(messages, 'user-1', 3);

    expect(evidence.transcriptMessages).toHaveLength(26);
    expect(evidence.transcriptMessages[0]?.id).toBe('user-1');
    expect(evidence.transcriptMessages[24]?.id).toBe('assistant-24');
    expect(evidence.transcriptMessages[25]?.id).toBe('tool-1');
  });
  it('preserves the full substantive verified result instead of truncating it during evidence collection', () => {
    const longVerifiedOutput = `verified-start ${'x'.repeat(9_000)} verified-end`;
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Audit the repository',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: longVerifiedOutput,
        toolCallId: 'tc-verify',
        timestamp: 2,
      },
    ];

    const evidence = collectAgentRunFinalizationEvidence(messages, 'user-1', 1);

    expect(evidence.lastSubstantiveResult).toBe(longVerifiedOutput);
    expect(evidence.lastSubstantiveResult).toContain('verified-end');
    expect(evidence.lastSubstantiveResult.length).toBe(longVerifiedOutput.length);
  });
  it('does not let session coordination polling replace previously captured worker evidence', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Finish the recovery workflow.',
        timestamp: 1,
      },
      {
        id: 'worker-1',
        role: 'assistant',
        content: 'Verifier completed.',
        timestamp: 2,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: {
            sessionId: 'sub-1',
            parentConversationId: 'conv-1',
            depth: 1,
            startedAt: 1,
            updatedAt: 2,
            status: 'completed',
            sandboxPolicy: 'inherit',
            name: 'Verifier',
            output:
              'Root cause confirmed. The recovery path still fails with the same schema mismatch.',
          },
        },
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({
          sessionId: 'sub-1',
          status: 'completed',
          hasOutput: true,
          output:
            'Root cause confirmed. The recovery path still fails with the same schema mismatch.',
          guidance: 'Use this output to continue or finalize; do not keep polling.',
        }),
        toolCallId: 'tc-session-output',
        timestamp: 3,
        toolCalls: [
          {
            id: 'tc-session-output',
            name: 'sessions_output',
            arguments: '{"sessionId":"sub-1"}',
            status: 'completed',
          },
        ],
      },
    ];

    const evidence = collectAgentRunFinalizationEvidence(messages, 'user-1', 1);

    expect(evidence.lastSubstantiveResult).toBe(
      'Root cause confirmed. The recovery path still fails with the same schema mismatch.',
    );
    expect(evidence.lastSubstantiveResultSourceName).toBe('Verifier');
    expect(evidence.resultPreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: 'Verifier',
          preview:
            'Root cause confirmed. The recovery path still fails with the same schema mismatch.',
        }),
        expect.objectContaining({
          sourceName: 'sessions_output',
          preview: expect.stringContaining('Root cause confirmed. The recovery path still fails'),
        }),
      ]),
    );
  });
  it('treats assistant-only draft evidence as recoverable only when synthesis is available', () => {
    const assistantOnlyEvidence = {
      originalPrompt: 'Summarize the cleanup',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Interrupted draft answer',
      lastSubstantiveResult: '',
      resultPreviews: [],
      toolsUsed: [],
      iterations: 0,
      hasIncompleteToolCalls: false,
    };

    expect(hasVerifiedFinalizationEvidence(assistantOnlyEvidence)).toBe(false);
    expect(
      canRecoverAgentRunFinalResponse({
        evidence: assistantOnlyEvidence,
        hasProviderContext: false,
        status: 'completed',
      }),
    ).toBe(false);
    expect(
      canRecoverAgentRunFinalResponse({
        evidence: assistantOnlyEvidence,
        hasProviderContext: true,
        status: 'completed',
      }),
    ).toBe(true);
  });
  it('does not treat interrupted running tool calls as recoverable synthesis evidence', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Finish the report.',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Working on it.',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-running',
            name: 'web_fetch',
            arguments: '{}',
            status: 'running',
          },
        ],
      },
    ];

    const evidence = collectAgentRunFinalizationEvidence(messages, 'user-1', 1);

    expect(evidence.hasIncompleteToolCalls).toBe(true);
    expect(hasVerifiedFinalizationEvidence(evidence)).toBe(false);
    expect(
      canRecoverAgentRunFinalResponse({
        evidence,
        hasProviderContext: true,
        status: 'completed',
      }),
    ).toBe(false);
  });
  it('treats failed tool calls without recorded terminal detail as incomplete evidence', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Finish the report.',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Working on it.',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-failed',
            name: 'web_fetch',
            arguments: '{}',
            status: 'failed',
          },
        ],
      },
    ];

    const evidence = collectAgentRunFinalizationEvidence(messages, 'user-1', 1);

    expect(evidence.hasIncompleteToolCalls).toBe(true);
    expect(hasVerifiedFinalizationEvidence(evidence)).toBe(false);
  });
  it('summarizes structured wait results without dumping raw output payloads', () => {
    const preview = summarizeFinalizationToolResultPreview(
      JSON.stringify({
        status: 'completed',
        sessionCount: 1,
        completedCount: 1,
        hasOutput: true,
        outputChars: 5200,
        output: 'Patched the workflow and verified the fix.'.repeat(80),
        outputPreview: 'Patched the workflow and verified the fix.',
      }),
    );

    expect(preview).toBe(
      '1/1 sessions completed; preview: Patched the workflow and verified the fix.; output captured (5200 chars)',
    );
  });
  it('promotes short terminal tool outputs to direct finalization deliverables', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Start background work, wait, then final exactly TOKEN42',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({
          status: 'completed',
          sessionCount: 1,
          completedCount: 1,
          sessions: [
            {
              sessionId: 'worker-1',
              status: 'completed',
              output: 'TOKEN42',
            },
          ],
        }),
        toolCallId: 'wait-1',
        timestamp: 2,
        toolCalls: [
          {
            id: 'wait-1',
            name: 'sessions_wait',
            arguments: '{}',
            status: 'completed',
          },
        ],
      },
    ];

    const evidence = collectAgentRunFinalizationEvidence(messages, 'user-1', 1);

    expect(evidence.terminalDeliverables).toEqual([{ sourceName: 'worker-1', output: 'TOKEN42' }]);
    expect(selectAgentRunDirectTerminalFinalOutput(evidence)).toBe('TOKEN42');
  });
  it('uses a single terminal deliverable as the completed-run fallback output', () => {
    const output = buildAgentRunCompletionFallbackOutput({
      status: 'completed',
      evidence: {
        originalPrompt: 'Return exactly TOKEN42',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: 'Worker completed.\n\nTOKEN42',
        lastSubstantiveResult: 'TOKEN42',
        resultPreviews: [{ sourceName: 'worker-1', preview: 'TOKEN42' }],
        terminalDeliverables: [{ sourceName: 'worker-1', output: 'TOKEN42' }],
        toolsUsed: ['sessions_wait'],
        iterations: 1,
        hasIncompleteToolCalls: false,
      },
    });

    expect(output).toBe('TOKEN42');
  });
});
