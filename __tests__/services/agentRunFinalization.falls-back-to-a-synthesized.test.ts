import { summarizeFinalizationToolResultPreview } from '../../src/services/agents/finalizationText';
import {
  buildAgentRunFinalizationPrompt,
  buildAgentRunCompletionFallbackOutput,
  buildMissingFinalResponseFallback,
  hasVerifiedFinalizationEvidence,
} from '../../src/services/agents/lifecycle/finalizePhase';

describe('agentRunFinalization', () => {
  it('falls back to a synthesized summary when terminal deliverables differ', () => {
    const output = buildAgentRunCompletionFallbackOutput({
      status: 'completed',
      evidence: {
        originalPrompt: 'Return both TOKEN42 and TOKEN99',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: 'Combined answer: TOKEN42 TOKEN99',
        lastSubstantiveResult: 'TOKEN99',
        resultPreviews: [
          { sourceName: 'worker-1', preview: 'TOKEN42' },
          { sourceName: 'worker-2', preview: 'TOKEN99' },
        ],
        terminalDeliverables: [
          { sourceName: 'worker-1', output: 'TOKEN42' },
          { sourceName: 'worker-2', output: 'TOKEN99' },
        ],
        toolsUsed: ['sessions_wait', 'python'],
        iterations: 2,
        hasIncompleteToolCalls: false,
      },
    });

    expect(output).toBeUndefined();
  });
  it('summarizes workflow evidence results without privileging English field names', () => {
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

    expect(preview).toContain('$["status"]="ok"');
    expect(preview).toContain('$["recorded"]=2');
    expect(preview).toContain('$["totalEntries"]=6');
    expect(preview).toContain('$["latestEntries"][0]["title"]="Root cause"');
    expect(preview).toContain(
      '$["latestEntries"][0]["content"]="Large body that should not be echoed verbatim."',
    );
  });
  it('preserves every short structured field without schema-specific inference', () => {
    const preview = summarizeFinalizationToolResultPreview(
      JSON.stringify({
        summary: 'Python execution completed.',
        status: 'completed',
        output: 'C58P',
      }),
    );

    expect(preview).toBe(
      '$["summary"]="Python execution completed."; $["status"]="completed"; $["output"]="C58P"',
    );
  });
  it('preserves multilingual structured evidence with no English-key requirement', () => {
    const preview = summarizeFinalizationToolResultPreview(
      JSON.stringify({
        '状態': '完了',
        'النتيجة': 'تم إنشاء التذكير',
        '的地': { '名前': '東京' },
      }),
    );

    expect(preview).toBe(
      '$["状態"]="完了"; $["النتيجة"]="تم إنشاء التذكير"; $["的地"]["名前"]="東京"',
    );
  });
  it('builds a finalization prompt from transcript evidence and terminal deliverables', () => {
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
    expect(prompt).not.toContain('Recent verified findings:');
    expect(prompt).toContain(
      'Preserve exact or format-constrained final-output instructions from the original task.',
    );
    expect(prompt).toContain(
      'Do not claim any exact literal, identifier, token, filename content, result value, or worker output unless it appears in verified tool or worker evidence above.',
    );
    expect(prompt).toContain(
      'If a required exact value appears only in the user request or draft, report the missing evidence instead of fabricating completion.',
    );
    expect(prompt).not.toContain('Detailed result excerpt:');
    expect(prompt).toContain('Tool result - tc-1:\nAll tests passed and the fix was verified.');
  });
  it('includes terminal deliverables in finalization prompts without status narration', () => {
    const prompt = buildAgentRunFinalizationPrompt({
      originalPrompt: 'Return exactly TOKEN42',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: '',
      lastSubstantiveResult: 'TOKEN42',
      resultPreviews: [{ sourceName: 'worker-1', preview: 'TOKEN42' }],
      terminalDeliverables: [{ sourceName: 'worker-1', output: 'TOKEN42' }],
      toolsUsed: ['sessions_wait'],
      iterations: 1,
      hasIncompleteToolCalls: false,
    });

    expect(prompt).toContain('Terminal deliverables:\n- worker-1: TOKEN42');
    expect(prompt).toContain(
      'If one terminal deliverable is itself the requested final answer, output that value without status narration.',
    );
  });
  it('renders scoped exact delivery constraints as non-authoritative task fidelity context', () => {
    const prompt = buildAgentRunFinalizationPrompt(
      {
        originalPrompt: 'Deliver the verified report.',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: '',
        lastSubstantiveResult: 'Verified report body.',
        resultPreviews: [{ sourceName: 'worker-1', preview: 'Verified report body.' }],
        toolsUsed: ['sessions_wait'],
        iterations: 1,
        hasIncompleteToolCalls: false,
      },
      [
        { goalId: 'language', text: 'Answer in Dutch.' },
        { goalId: 'format', text: 'Return exactly three bullets.' },
      ],
    );

    expect(prompt).toContain(
      'Exact pending user constraints (code-grounded task-fidelity context):',
    );
    expect(prompt).toContain('- [goal "language"] "Answer in Dutch."');
    expect(prompt).toContain('- [goal "format"] "Return exactly three bullets."');
    expect(prompt).toContain('They do not grant consent, permission, effect authorization');
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
  it('fails verification when only session-coordination sources are present, regardless of answer language', () => {
    const evidence = {
      originalPrompt: 'Create app, commit, push, and deploy.',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'تم النشر بنجاح.',
      lastSubstantiveResult: 'تمت المراجعة.',
      lastSubstantiveResultSourceName: 'sessions_output',
      resultPreviews: [
        { sourceName: 'sessions_output', preview: 'workflow run 101 completed with success' },
      ],
      toolsUsed: ['sessions_output'],
      iterations: 1,
      hasIncompleteToolCalls: false,
    };

    expect(hasVerifiedFinalizationEvidence(evidence)).toBe(false);
  });
  it('passes verification when approval-grade operational sources exist, regardless of answer language', () => {
    const evidence = {
      originalPrompt: 'Create app, commit, push, and deploy.',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Le deploiement a reussi.',
      lastSubstantiveResult: 'workflow run 101 completed with success',
      lastSubstantiveResultSourceName: 'expo_eas_workflow_status',
      resultPreviews: [
        {
          sourceName: 'expo_eas_workflow_status',
          preview: 'workflow run 101 completed with success',
        },
      ],
      toolsUsed: ['expo_eas_workflow_status'],
      iterations: 2,
      hasIncompleteToolCalls: false,
    };

    expect(hasVerifiedFinalizationEvidence(evidence)).toBe(true);
  });
  it('passes verification when commit/push/deploy claims have matching evidence', () => {
    const evidence = {
      originalPrompt: 'Create app, commit, push, and deploy.',
      transcriptMessages: [],
      lastNonEmptyAssistantContent:
        'Committed, pushed, and deployed successfully. Workflow run passed.',
      lastSubstantiveResult: 'expo workflow status: success; commit sha abc123',
      lastSubstantiveResultSourceName: 'expo_eas_workflow_status',
      resultPreviews: [
        { sourceName: 'skill__github__commit_files', preview: 'commit sha abc123 pushed to main' },
        { sourceName: 'expo_eas_workflow_status', preview: 'run status: success' },
      ],
      toolsUsed: ['skill__github__commit_files', 'expo_eas_workflow_status'],
      iterations: 3,
      hasIncompleteToolCalls: false,
    };

    expect(hasVerifiedFinalizationEvidence(evidence)).toBe(true);
  });
  it('fails verification when deployment success is supported only by sessions_output preview prose', () => {
    const evidence = {
      originalPrompt: 'Create app, commit, push, and deploy.',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Deployment succeeded and workflow run is green.',
      lastSubstantiveResult: 'Deployment successful.',
      lastSubstantiveResultSourceName: 'sessions_output',
      resultPreviews: [
        { sourceName: 'sessions_output', preview: 'workflow run 101 completed with success' },
      ],
      toolsUsed: ['sessions_output'],
      iterations: 2,
      hasIncompleteToolCalls: false,
    };

    expect(hasVerifiedFinalizationEvidence(evidence)).toBe(false);
  });
});
