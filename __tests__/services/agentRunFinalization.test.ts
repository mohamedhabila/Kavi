import type { Message } from '../../src/types';
import { summarizeFinalizationToolResultPreview } from '../../src/services/agents/finalizationText';
import {
  buildAgentRunFinalizationPrompt,
  buildAgentRunToolResultFallback,
  buildAgentRunVisibleDraftRecoveryText,
  buildMissingFinalResponseFallback,
  canRecoverAgentRunFinalResponse,
  collectAgentRunFinalizationEvidence,
  hasVerifiedFinalizationEvidence,
} from '../../src/services/agents/agentRunFinalization';

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
            output: 'Repository audit complete. Patched the failing workflow.',
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
          sourceName: 'run_tests',
          preview: 'Verified the patch and tests passed.',
        }),
      ]),
    );
    expect(evidence.lastSubstantiveResult).toContain('Verified the patch and tests passed.');
    expect(evidence.toolsUsed).toEqual(expect.arrayContaining(['sessions_spawn', 'run_tests']));
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
            output: 'Root cause confirmed. The recovery path still fails with the same schema mismatch.',
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
          preview: 'Root cause confirmed. The recovery path still fails with the same schema mismatch.',
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

  it('builds a deduped fallback summary from verified previews', () => {
    const fallback = buildAgentRunToolResultFallback({
      status: 'failed',
      evidence: {
        originalPrompt: 'Audit the repo',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: '',
        lastSubstantiveResult: '',
        resultPreviews: [
          { sourceName: 'worker-a', preview: 'Found the root cause.' },
          { sourceName: 'worker-a', preview: 'Found the root cause.' },
          { sourceName: 'worker-b', preview: 'Applied the fix.' },
        ],
        toolsUsed: ['sessions_spawn'],
        iterations: 2,
        hasIncompleteToolCalls: false,
      },
    });

    expect(fallback).toBe(
      [
        'Latest verified findings before the failure:',
        '- worker-a: Found the root cause.',
        '- worker-b: Applied the fix.',
      ].join('\n'),
    );
  });

  it('limits fallback findings to the most recent compact preview lines', () => {
    const fallback = buildAgentRunToolResultFallback({
      status: 'failed',
      evidence: {
        originalPrompt: 'Audit the repo',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: '',
        lastSubstantiveResult: '',
        resultPreviews: Array.from({ length: 8 }, (_, index) => ({
          sourceName: `worker-${index + 1}`,
          preview: `Finding ${index + 1}`,
        })),
        toolsUsed: ['sessions_spawn'],
        iterations: 4,
        hasIncompleteToolCalls: false,
      },
    });

    expect(fallback).toBe(
      [
        'Latest verified findings before the failure:',
        '- worker-3: Finding 3',
        '- worker-4: Finding 4',
        '- worker-5: Finding 5',
        '- worker-6: Finding 6',
        '- worker-7: Finding 7',
        '- worker-8: Finding 8',
      ].join('\n'),
    );
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

  it('summarizes workflow evidence results instead of echoing structured entry payloads', () => {
    const preview = summarizeFinalizationToolResultPreview(
      JSON.stringify({
        status: 'ok',
        recorded: 2,
        totalEntries: 6,
        latestEntries: [
          { title: 'Root cause', content: 'Large body that should not be echoed verbatim.' },
        ],
      }),
    );

    expect(preview).toBe('2 evidence entries recorded');
  });

  it('builds a finalization prompt with transcript, verified findings, and a detailed result excerpt', () => {
    const prompt = buildAgentRunFinalizationPrompt({
      originalPrompt: 'Audit the repository',
      transcriptMessages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Audit the repository',
          timestamp: 1,
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Launching verification tools.',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-1',
              name: 'run_tests',
              arguments: '{}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: 'All tests passed and the fix was verified.',
          toolCallId: 'tc-1',
          timestamp: 3,
        },
      ],
      lastNonEmptyAssistantContent: 'Launching verification tools.',
      lastSubstantiveResult: 'All tests passed and the fix was verified.',
      resultPreviews: [
        { sourceName: 'run_tests', preview: 'All tests passed and the fix was verified.' },
      ],
      toolsUsed: ['run_tests'],
      iterations: 1,
      hasIncompleteToolCalls: false,
    });

    expect(prompt).toContain('Original task:\nAudit the repository');
    expect(prompt).toContain('Execution transcript:');
    expect(prompt).toContain('Assistant (requested tools: run_tests):');
    expect(prompt).toContain(
      'Recent verified findings:\n- run_tests: All tests passed and the fix was verified.',
    );
    expect(prompt).toContain(
      'Detailed result excerpt:\nAll tests passed and the fix was verified.',
    );
  });

  it('adds source-attribution guidance when finalizing official-doc research answers', () => {
    const prompt = buildAgentRunFinalizationPrompt({
      originalPrompt: 'Compare OpenAI, Anthropic, and Gemini using official docs.',
      transcriptMessages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Compare OpenAI, Anthropic, and Gemini using official docs.',
          timestamp: 1,
        },
      ],
      lastNonEmptyAssistantContent: 'OpenAI appears strongest for orchestration.',
      lastSubstantiveResult: 'Verified provider findings.',
      resultPreviews: [{ sourceName: 'worker', preview: 'Verified provider findings.' }],
      toolsUsed: ['web_search'],
      iterations: 1,
      hasIncompleteToolCalls: false,
    });

    expect(prompt).toContain(
      'Attribute provider-specific research claims to named sources or URLs in the final answer.',
    );
    expect(prompt).toContain(
      'Omit or clearly qualify any quantitative or superlative claim that is not directly supported by the verified evidence.',
    );
  });

  it('does not reuse assistant draft text when a failed run is repaired', () => {
    const fallback = buildAgentRunToolResultFallback({
      status: 'failed',
      evidence: {
        originalPrompt: 'Audit the repo',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: 'Draft answer that should not be promoted.',
        lastSubstantiveResult: '',
        resultPreviews: [],
        toolsUsed: [],
        iterations: 0,
        hasIncompleteToolCalls: false,
      },
    });

    expect(fallback).toBeUndefined();
  });

  it('preserves a visible failed draft and appends only the net-new verified findings', () => {
    const recoveredText = buildAgentRunVisibleDraftRecoveryText({
      status: 'failed',
      visibleDraft: ['Draft answer.', 'Here are the latest verified findings before the failure:'].join(
        '\n\n',
      ),
      evidence: {
        originalPrompt: 'Audit the repo',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: '',
        lastSubstantiveResult: '',
        resultPreviews: [
          { sourceName: 'worker-a', preview: 'Draft answer.' },
          { sourceName: 'worker-b', preview: 'Applied the fix.' },
        ],
        toolsUsed: ['sessions_spawn'],
        iterations: 1,
        hasIncompleteToolCalls: false,
      },
    });

    expect(recoveredText).toBe(
      [
        'Draft answer.',
        '',
        'Here are the latest verified findings before the failure:',
        '',
        'Note: the response stream failed before the answer could finish.',
        '- worker-b: Applied the fix.',
      ].join('\n'),
    );
  });

  it('appends a failure note even when there are no verified preview lines to add', () => {
    const recoveredText = buildAgentRunVisibleDraftRecoveryText({
      status: 'failed',
      visibleDraft: 'Partial answer already shown to the user.',
      evidence: {
        originalPrompt: 'Audit the repo',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: '',
        lastSubstantiveResult: '',
        resultPreviews: [],
        toolsUsed: [],
        iterations: 0,
        hasIncompleteToolCalls: false,
      },
    });

    expect(recoveredText).toBe(
      [
        'Partial answer already shown to the user.',
        '',
        'Note: the response stream failed before the answer could finish.',
      ].join('\n'),
    );
  });

  it('returns stable missing-final-response fallbacks by status', () => {
    expect(buildMissingFinalResponseFallback('completed')).toBe(
      'The run completed, but no final response was generated.',
    );
    expect(buildMissingFinalResponseFallback('failed')).toBe(
      'The run failed before it generated a final response.',
    );
    expect(buildMissingFinalResponseFallback('cancelled')).toBe(
      'The run was cancelled before it generated a final response.',
    );
  });
});
