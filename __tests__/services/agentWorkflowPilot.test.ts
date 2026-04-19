import type { AgentRun, Message, SubAgentSnapshot } from '../../src/types';
import {
  decideAgentRunPilotAfterBackgroundWorkers,
  evaluateAgentRunWithPilot,
  PILOT_REVIEW_CHECKPOINT_TITLE,
} from '../../src/services/agents/agentWorkflowPilot';

const mockStreamMessage = jest.fn();
const mockSendMessage = jest.fn();

jest.mock('../../src/services/memory/store', () => ({
  getConversationMemoryForSystemPrompt: jest.fn().mockResolvedValue('Conversation memory: pending validation notes.'),
  getMemoryForSystemPrompt: jest.fn().mockResolvedValue('Global memory: prefer production-ready verification.'),
}));

jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    streamMessage: (...args: any[]) => mockStreamMessage(...args),
    sendMessage: (...args: any[]) => mockSendMessage(...args),
  })),
}));

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Ship the production-ready fix.',
    timestamp: 10,
    ...overrides,
  };
}

const DEFAULT_SUCCESS_CRITERIA = [
  'Produce the requested deliverable.',
  'Verify the result before finalizing.',
];

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'msg-user',
    goal: 'Ship a production-ready fix.',
    status: 'running',
    awaitingBackgroundWorkers: true,
    createdAt: 1,
    updatedAt: 30,
    currentPhase: 'pilot',
    phases: [],
    checkpoints: [],
    plan: {
      objective: 'Ship a production-ready fix.',
      successCriteria: DEFAULT_SUCCESS_CRITERIA,
      stopConditions: ['Stop when the deliverable is complete and verified.'],
      workstreams: [],
      updatedAt: 1,
    },
    summary: {
      assistantTurns: 1,
      startedTools: 2,
      completedTools: 1,
      failedTools: 1,
      spawnedSubAgents: 1,
    },
    ...overrides,
  };
}

function makeWorker(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-1',
    parentConversationId: 'conv-1',
    agentRunId: 'run-1',
    depth: 0,
    startedAt: 10,
    updatedAt: 40,
    status: 'completed',
    sandboxPolicy: 'inherit',
    output: 'Verified implementation details.',
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<any> = {}) {
  return {
    originalPrompt: 'Fix the workflow and verify it.',
    transcriptMessages: [
      makeMessage({ id: 'msg-user', role: 'user', content: 'Fix the workflow and verify it.', timestamp: 10 }),
      makeMessage({ id: 'msg-assistant', role: 'assistant', content: 'I have a final draft answer.', timestamp: 20 }),
    ],
    lastNonEmptyAssistantContent: 'I have a final draft answer.',
    lastSubstantiveResult: 'Verified implementation details.',
    resultPreviews: [{ sourceName: 'worker', preview: 'Verified implementation details.' }],
    toolsUsed: ['sessions_spawn'],
    iterations: 2,
    ...overrides,
  };
}

function makeProviderContext() {
  return {
    provider: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5.4',
      enabled: true,
    },
    model: 'gpt-5.4',
    systemPromptText: 'You are the SuperAgent executor. Gather evidence before finalizing.',
    conversationId: 'conv-1',
  };
}

function makeGeminiProviderContext() {
  return {
    provider: {
      id: 'gemini',
      name: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'AIza-test',
      model: 'gemini-3-flash-preview',
      enabled: true,
    },
    model: 'gemini-3-flash-preview',
    systemPromptText: 'You are the SuperAgent executor. Gather evidence before finalizing.',
    conversationId: 'conv-1',
  };
}

function makeAnthropicProviderContext() {
  return {
    provider: {
      id: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6',
      enabled: true,
    },
    model: 'claude-sonnet-4-6',
    systemPromptText: 'You are the SuperAgent executor. Gather evidence before finalizing.',
    conversationId: 'conv-1',
  };
}

function makePilotPayload(criteria: string[] = DEFAULT_SUCCESS_CRITERIA, overrides: Record<string, any> = {}) {
  const basePayload = {
    recommendedAction: 'finalize',
    controlAction: 'accept',
    completionScore: 5,
    adherenceScore: 4,
    evidenceScore: 5,
    processScore: 4,
    approved: true,
    confidence: 'high',
    summary: 'The run is complete and verified.',
    rationale: 'All requested work is done and backed by verified evidence.',
    strengths: ['Verified evidence captured.'],
    gaps: [],
    nextActions: [],
    criterionEvaluations: criteria.map((criterion, index) => ({
      criterion,
      score: index === 0 ? 5 : 4,
      status: 'met',
      rationale: index === 0 ? 'The deliverable exists.' : 'The result is verified.',
    })),
  };

  return {
    ...basePayload,
    ...overrides,
    criterionEvaluations: overrides.criterionEvaluations ?? basePayload.criterionEvaluations,
  };
}

describe('agentWorkflowPilot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamMessage.mockReset();
    mockSendMessage.mockReset();
  });

  it('resumes the supervisor heuristically when a background worker fails', () => {
    const decision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun(),
      workers: [makeWorker({ status: 'error', output: 'pytest failed with a schema mismatch.', updatedAt: 40 })],
      evidence: makeEvidence(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.checkpointTitle).toBe(PILOT_REVIEW_CHECKPOINT_TITLE);
    expect(decision.evaluation.recommendedAction).toBe('continue');
    expect(decision.evaluation.controlAction).toBe('continue');
    expect(decision.reviewPrompt).toContain('Pilot criterion review:');
    expect(decision.reviewPrompt).toContain('Continue this existing workflow run from its current state.');
    expect(decision.reviewPrompt).toContain('Do not restart from scratch, open a replacement run, or discard prior verified work.');
    expect(decision.reviewPrompt).toContain('If the transcript already contains user-visible answer text, treat your next answer as a continuation of that same answer rather than a replacement response.');
    expect(decision.reviewPrompt).toContain('If the visible draft already contains section headings, numbering, or bullet groups, continue within that structure instead of starting those sections over.');
    expect(decision.reviewPrompt).toContain('Existing user-visible draft/output to continue:');
    expect(decision.reviewPrompt).toContain('I have a final draft answer.');
    expect(decision.reviewUserPrompt).toContain('Write only the net-new text that should be appended to improve that answer.');
    expect(decision.reviewUserPrompt).toContain('If the visible answer already has headings, numbered parts, or bullets, preserve that structure and continue from the first missing idea instead of reintroducing those headings again.');
    expect(decision.reviewUserPrompt).toContain('Visible answer already shown to the user (do not repeat it verbatim):');
    expect(decision.reviewUserPrompt).toContain('I have a final draft answer.');
  });

  it('carries prior pilot correction history into the next continuation prompt', () => {
    const decision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        checkpoints: [
          {
            id: 'cp-1',
            timestamp: 50,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot score 12/20. Preserve the current draft and add stronger verification.',
          },
          {
            id: 'cp-2',
            timestamp: 60,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot score 14/20. Keep the existing findings and close the remaining evidence gap.',
          },
        ],
      }),
      workers: [makeWorker({ status: 'error', output: 'pytest failed with a schema mismatch.', updatedAt: 400 })],
      evidence: makeEvidence(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.reviewPrompt).toContain('Pilot correction cycle: 3. This is a continuation of the same workflow run, not a new run.');
    expect(decision.reviewPrompt).toContain('Prior pilot review history:');
    expect(decision.reviewPrompt).toContain('Correction cycle 1: Pilot score 12/20. Preserve the current draft and add stronger verification.');
    expect(decision.reviewPrompt).toContain('Correction cycle 2: Pilot score 14/20. Keep the existing findings and close the remaining evidence gap.');
    expect(decision.reviewPrompt).toContain('Prefer continuing existing work with focused follow-up instructions, targeted verification, draft revision, or additive workers before replacing prior work.');
  });

  it('does not queue a second heuristic pilot review for the same observed state', () => {
    const decision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        checkpoints: [
          {
            id: 'cp-1',
            timestamp: 50,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot already reviewed this state.',
          },
        ],
      }),
      workers: [makeWorker({ status: 'error', updatedAt: 40, output: 'pytest failed with a schema mismatch.' })],
      evidence: makeEvidence(),
    });

    expect(decision.action).toBe('finalize');
    expect(decision.outcome.status).toBe('failed');
  });

  it('treats timestamp-only churn as the same reviewed pilot state', () => {
    const firstDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun(),
      workers: [makeWorker({ status: 'error', updatedAt: 40, output: 'pytest failed with a schema mismatch.' })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-1', role: 'user', content: 'Recover the workflow.', timestamp: 10 }),
          makeMessage({ id: 'msg-assistant-1', role: 'assistant', content: 'The latest recovery attempt failed.', timestamp: 20 }),
        ],
        lastNonEmptyAssistantContent: 'The latest recovery attempt failed.',
        lastSubstantiveResult: 'pytest failed with a schema mismatch.',
        resultPreviews: [{ sourceName: 'worker', preview: 'pytest failed with a schema mismatch.' }],
        toolsUsed: ['sessions_status', 'sessions_status'],
      }),
    });

    const secondDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 500,
        checkpoints: [
          {
            id: 'cp-1',
            timestamp: 60,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot already reviewed this state.',
          },
        ],
        latestPilotEvaluation: firstDecision.evaluation,
      }),
      workers: [makeWorker({ status: 'error', updatedAt: 400, output: 'pytest failed with a schema mismatch.' })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-2', role: 'user', content: 'Recover the workflow.', timestamp: 310 }),
          makeMessage({ id: 'msg-assistant-2', role: 'assistant', content: 'The latest recovery attempt failed.', timestamp: 320 }),
        ],
        lastNonEmptyAssistantContent: 'The latest recovery attempt failed.',
        lastSubstantiveResult: 'pytest failed with a schema mismatch.',
        resultPreviews: [
          { sourceName: 'worker', preview: 'pytest failed with a schema mismatch.' },
          { sourceName: 'worker', preview: 'pytest failed with a schema mismatch.' },
        ],
        toolsUsed: ['sessions_status', 'sessions_status', 'sessions_status'],
      }),
    });

    expect(firstDecision.action).toBe('resume');
    expect(secondDecision.action).toBe('finalize');
    expect(secondDecision.outcome.status).toBe('failed');
    expect(secondDecision.evaluation.stateSignature).toBe(firstDecision.evaluation.stateSignature);
    expect(firstDecision.evaluation.stateSignature).toMatch(/^pilot-state-v1:[0-9a-f]{16}$/);
  });

  it('treats respawned workers with the same logical name and output as the same reviewed pilot state', () => {
    const firstDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun(),
      workers: [makeWorker({
        name: 'Summarizer',
        sessionId: 'sub-1',
        status: 'error',
        updatedAt: 40,
        output: 'The recovery path still fails with the same schema mismatch.',
      })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-1a', role: 'user', content: 'Recover the workflow.', timestamp: 10 }),
          makeMessage({ id: 'msg-assistant-1a', role: 'assistant', content: 'The latest recovery attempt failed.', timestamp: 20 }),
        ],
        lastNonEmptyAssistantContent: 'The latest recovery attempt failed.',
        lastSubstantiveResult: 'The recovery path still fails with the same schema mismatch.',
        resultPreviews: [{ sourceName: 'Summarizer', preview: 'The recovery path still fails with the same schema mismatch.' }],
        toolsUsed: ['sessions_wait'],
      }),
    });

    const secondDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 500,
        checkpoints: [
          {
            id: 'cp-worker-session-churn',
            timestamp: 60,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot already reviewed this state.',
          },
        ],
        latestPilotEvaluation: firstDecision.evaluation,
      }),
      workers: [makeWorker({
        name: 'Summarizer',
        sessionId: 'sub-2',
        status: 'error',
        updatedAt: 400,
        output: 'The recovery path still fails with the same schema mismatch.',
      })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-2a', role: 'user', content: 'Recover the workflow.', timestamp: 310 }),
          makeMessage({ id: 'msg-assistant-2a', role: 'assistant', content: 'The latest recovery attempt failed.', timestamp: 320 }),
        ],
        lastNonEmptyAssistantContent: 'The latest recovery attempt failed.',
        lastSubstantiveResult: 'The recovery path still fails with the same schema mismatch.',
        resultPreviews: [{ sourceName: 'Summarizer', preview: 'The recovery path still fails with the same schema mismatch.' }],
        toolsUsed: ['sessions_wait'],
      }),
    });

    expect(firstDecision.action).toBe('resume');
    expect(secondDecision.action).toBe('finalize');
    expect(secondDecision.outcome.status).toBe('failed');
    expect(secondDecision.evaluation.stateSignature).toBe(firstDecision.evaluation.stateSignature);
  });

  it('ignores session coordination tool churn when matching reviewed pilot state', () => {
    const firstDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun(),
      workers: [makeWorker({
        name: 'Verifier',
        sessionId: 'sub-coord-1',
        status: 'error',
        updatedAt: 40,
        output: 'The verification path still fails with the same schema mismatch.',
      })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-1b', role: 'user', content: 'Recover the workflow.', timestamp: 10 }),
          makeMessage({ id: 'msg-assistant-1b', role: 'assistant', content: 'The latest recovery attempt failed.', timestamp: 20 }),
        ],
        lastNonEmptyAssistantContent: 'The latest recovery attempt failed.',
        lastSubstantiveResult: 'The verification path still fails with the same schema mismatch.',
        resultPreviews: [{ sourceName: 'Verifier', preview: 'The verification path still fails with the same schema mismatch.' }],
        toolsUsed: ['run_tests'],
      }),
    });

    const secondDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 500,
        checkpoints: [
          {
            id: 'cp-coordination-churn',
            timestamp: 60,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot already reviewed this state.',
          },
        ],
        latestPilotEvaluation: firstDecision.evaluation,
      }),
      workers: [makeWorker({
        name: 'Verifier',
        sessionId: 'sub-coord-2',
        status: 'error',
        updatedAt: 400,
        output: 'The verification path still fails with the same schema mismatch.',
      })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-2b', role: 'user', content: 'Recover the workflow.', timestamp: 310 }),
          makeMessage({ id: 'msg-assistant-2b', role: 'assistant', content: 'The latest recovery attempt failed.', timestamp: 320 }),
        ],
        lastNonEmptyAssistantContent: 'The latest recovery attempt failed.',
        lastSubstantiveResult: 'The verification path still fails with the same schema mismatch.',
        resultPreviews: [
          { sourceName: 'sessions_spawn', preview: '0 artifacts; preview (600 chars); output captured (2122 chars; preview only)' },
          { sourceName: 'sessions_wait', preview: '1/1 sessions completed; preview: The verification path still fails with the same schema mismatch.' },
          { sourceName: 'Verifier', preview: 'The verification path still fails with the same schema mismatch.' },
        ],
        toolsUsed: ['run_tests', 'sessions_spawn', 'sessions_wait'],
      }),
    });

    expect(firstDecision.action).toBe('resume');
    expect(secondDecision.action).toBe('finalize');
    expect(secondDecision.outcome.status).toBe('failed');
    expect(secondDecision.evaluation.stateSignature).toBe(firstDecision.evaluation.stateSignature);
  });

  it('re-queues heuristic pilot review when the cached state signature changes without newer timestamps', () => {
    const firstDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({ updatedAt: 100 }),
      workers: [makeWorker({ status: 'error', updatedAt: 100, output: 'Initial recovery path still fails.' })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-1', role: 'user', content: 'Recover the workflow.', timestamp: 100 }),
          makeMessage({ id: 'msg-assistant-1', role: 'assistant', content: 'The current recovery attempt is still failing.', timestamp: 100 }),
        ],
        lastNonEmptyAssistantContent: 'The current recovery attempt is still failing.',
        lastSubstantiveResult: 'Initial recovery path still fails.',
        resultPreviews: [{ sourceName: 'worker', preview: 'Initial recovery path still fails.' }],
        toolsUsed: ['sessions_status'],
      }),
    });

    const secondDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 100,
        checkpoints: [{
          id: 'cp-1',
          timestamp: 100,
          kind: 'run',
          title: PILOT_REVIEW_CHECKPOINT_TITLE,
          detail: 'Pilot asked for a recovery attempt.',
        }],
        latestPilotEvaluation: firstDecision.evaluation,
      }),
      workers: [makeWorker({ status: 'error', updatedAt: 100, output: 'A different recovery path is now failing.' })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-2', role: 'user', content: 'Recover the workflow.', timestamp: 100 }),
          makeMessage({ id: 'msg-assistant-2', role: 'assistant', content: 'The new recovery attempt is failing in a different way.', timestamp: 100 }),
        ],
        lastNonEmptyAssistantContent: 'The new recovery attempt is failing in a different way.',
        lastSubstantiveResult: 'A different recovery path is now failing.',
        resultPreviews: [{ sourceName: 'worker', preview: 'A different recovery path is now failing.' }],
        toolsUsed: ['sessions_status'],
      }),
    });

    expect(firstDecision.action).toBe('resume');
    expect(secondDecision.action).toBe('resume');
    expect(secondDecision.evaluation.stateSignature).not.toBe(firstDecision.evaluation.stateSignature);
  });

  it('keeps large pilot state signatures fixed-width so same-state caching survives persistence', () => {
    const largePreview = 'Verified recovery evidence. '.repeat(80);
    const firstDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({ updatedAt: 100 }),
      workers: [makeWorker({
        status: 'error',
        updatedAt: 100,
        output: 'Recovery attempt still fails, but the current evidence set is stable.',
      })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-large-1', role: 'user', content: 'Recover the workflow.', timestamp: 100 }),
          makeMessage({ id: 'msg-assistant-large-1', role: 'assistant', content: 'Large persistence-safe review payload.', timestamp: 100 }),
        ],
        lastNonEmptyAssistantContent: 'Large persistence-safe review payload.',
        lastSubstantiveResult: largePreview,
        resultPreviews: Array.from({ length: 12 }, (_, index) => ({
          sourceName: `worker-${index}`,
          preview: `${largePreview}${index}`,
        })),
        toolsUsed: ['sessions_status', 'read_file', 'sessions_status'],
      }),
    });

    const secondDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 500,
        checkpoints: [
          {
            id: 'cp-large-1',
            timestamp: 120,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot already reviewed this state.',
          },
        ],
        latestPilotEvaluation: {
          ...firstDecision.evaluation,
        },
      }),
      workers: [makeWorker({
        status: 'error',
        updatedAt: 400,
        output: 'Recovery attempt still fails, but the current evidence set is stable.',
      })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-large-2', role: 'user', content: 'Recover the workflow.', timestamp: 310 }),
          makeMessage({ id: 'msg-assistant-large-2', role: 'assistant', content: 'Large persistence-safe review payload.', timestamp: 320 }),
        ],
        lastNonEmptyAssistantContent: 'Large persistence-safe review payload.',
        lastSubstantiveResult: largePreview,
        resultPreviews: Array.from({ length: 12 }, (_, index) => ({
          sourceName: `worker-${index}`,
          preview: `${largePreview}${index}`,
        })),
        toolsUsed: ['read_file', 'sessions_status'],
      }),
    });

    expect(firstDecision.evaluation.stateSignature).toMatch(/^pilot-state-v1:[0-9a-f]{16}$/);
    expect(firstDecision.evaluation.stateSignature?.length).toBeLessThan(40);
    expect(secondDecision.action).toBe('finalize');
    expect(secondDecision.outcome.status).toBe('failed');
    expect(secondDecision.evaluation.stateSignature).toBe(firstDecision.evaluation.stateSignature);
  });

  it('treats structured workflow evidence changes as a new pilot state', () => {
    const firstDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 100,
        evidence: [
          {
            id: 'ev-1',
            kind: 'fact',
            status: 'verified',
            recorder: 'worker',
            title: 'Initial verification',
            content: 'Confirmed the fix in the workspace.',
            createdAt: 100,
            updatedAt: 100,
          },
        ],
      }),
      workers: [makeWorker({ status: 'error', updatedAt: 100, output: 'The current recovery path still fails.' })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-structured-1', role: 'user', content: 'Recover the workflow.', timestamp: 100 }),
          makeMessage({ id: 'msg-assistant-structured-1', role: 'assistant', content: 'The current recovery path still fails.', timestamp: 100 }),
        ],
        lastNonEmptyAssistantContent: 'The current recovery path still fails.',
        lastSubstantiveResult: 'The current recovery path still fails.',
        resultPreviews: [{ sourceName: 'worker', preview: 'The current recovery path still fails.' }],
        toolsUsed: ['sessions_status'],
      }),
    });

    const secondDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 100,
        checkpoints: [{
          id: 'cp-structured-1',
          timestamp: 100,
          kind: 'run',
          title: PILOT_REVIEW_CHECKPOINT_TITLE,
          detail: 'Pilot asked for a recovery attempt.',
        }],
        latestPilotEvaluation: firstDecision.evaluation,
        evidence: [
          {
            id: 'ev-1',
            kind: 'fact',
            status: 'verified',
            recorder: 'worker',
            title: 'Initial verification',
            content: 'Confirmed the fix in the workspace.',
            createdAt: 100,
            updatedAt: 100,
          },
          {
            id: 'ev-2',
            kind: 'artifact',
            status: 'verified',
            recorder: 'worker',
            title: 'New regression log',
            content: 'Captured a new failing test artifact after the pilot review.',
            artifactWorkspacePath: 'artifacts/failing-test.log',
            createdAt: 100,
            updatedAt: 100,
          },
        ],
      }),
      workers: [makeWorker({ status: 'error', updatedAt: 100, output: 'The current recovery path still fails.' })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-structured-2', role: 'user', content: 'Recover the workflow.', timestamp: 100 }),
          makeMessage({ id: 'msg-assistant-structured-2', role: 'assistant', content: 'The current recovery path still fails.', timestamp: 100 }),
        ],
        lastNonEmptyAssistantContent: 'The current recovery path still fails.',
        lastSubstantiveResult: 'The current recovery path still fails.',
        resultPreviews: [{ sourceName: 'worker', preview: 'The current recovery path still fails.' }],
        toolsUsed: ['sessions_status'],
      }),
    });

    expect(firstDecision.action).toBe('resume');
    expect(secondDecision.action).toBe('resume');
    expect(secondDecision.evaluation.stateSignature).not.toBe(firstDecision.evaluation.stateSignature);
  });

  it('continues autonomously after many prior pilot checkpoints when the state has genuinely changed', () => {
    const decision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        checkpoints: Array.from({ length: 10 }, (_, index) => ({
          id: `cp-${index + 1}`,
          timestamp: 20 + index,
          kind: 'run',
          title: PILOT_REVIEW_CHECKPOINT_TITLE,
          detail: 'Pilot already reviewed an older state.',
        })),
      }),
      workers: [makeWorker({ status: 'error', output: 'pytest failed with a schema mismatch.', updatedAt: 400 })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user', role: 'user', content: 'Recover the workflow.', timestamp: 10 }),
          makeMessage({ id: 'msg-assistant', role: 'assistant', content: 'The latest recovery attempt failed.', timestamp: 300 }),
        ],
      }),
    });

    expect(decision.action).toBe('resume');
    expect(decision.evaluation.controlAction).toBe('continue');
  });

  it('blocks repeated pilot correction cycles when scores do not materially improve', () => {
    const firstDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({ updatedAt: 100 }),
      workers: [makeWorker({
        name: 'Verifier',
        sessionId: 'sub-progress-1',
        status: 'error',
        updatedAt: 100,
        output: 'Initial recovery path still fails with the same schema mismatch.',
      })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-progress-1', role: 'user', content: 'Recover the workflow.', timestamp: 100 }),
          makeMessage({ id: 'msg-assistant-progress-1', role: 'assistant', content: 'The current recovery attempt is still failing.', timestamp: 100 }),
        ],
        lastNonEmptyAssistantContent: 'The current recovery attempt is still failing.',
        lastSubstantiveResult: 'Initial recovery path still fails with the same schema mismatch.',
        resultPreviews: [{ sourceName: 'Verifier', preview: 'Initial recovery path still fails with the same schema mismatch.' }],
        toolsUsed: ['run_tests'],
      }),
    });

    const secondDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 200,
        checkpoints: Array.from({ length: 3 }, (_, index) => ({
          id: `cp-progress-${index + 1}`,
          timestamp: 120 + index,
          kind: 'run',
          title: PILOT_REVIEW_CHECKPOINT_TITLE,
          detail: `Pilot correction cycle ${index + 1} retried the recovery path without closing the verification gap.`,
        })),
        latestPilotEvaluation: firstDecision.evaluation,
      }),
      workers: [makeWorker({
        name: 'Verifier',
        sessionId: 'sub-progress-2',
        status: 'error',
        updatedAt: 200,
        output: 'A different recovery attempt still fails with the same schema mismatch.',
      })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-progress-2', role: 'user', content: 'Recover the workflow.', timestamp: 200 }),
          makeMessage({ id: 'msg-assistant-progress-2', role: 'assistant', content: 'The alternate recovery attempt is still failing.', timestamp: 200 }),
        ],
        lastNonEmptyAssistantContent: 'The alternate recovery attempt is still failing.',
        lastSubstantiveResult: 'A different recovery attempt still fails with the same schema mismatch.',
        resultPreviews: [{ sourceName: 'Verifier', preview: 'A different recovery attempt still fails with the same schema mismatch.' }],
        toolsUsed: ['run_tests'],
      }),
    });

    expect(firstDecision.action).toBe('resume');
    expect(secondDecision.action).toBe('finalize');
    expect(secondDecision.checkpointTitle).toBe('Pilot blocked finalization');
    expect(secondDecision.outcome.status).toBe('cancelled');
    expect(secondDecision.evaluation.recommendedAction).toBe('blocked');
    expect(secondDecision.evaluation.controlAction).toBe('block');
    expect(secondDecision.evaluation.summary).toContain('stopped autonomous correction');
    expect(secondDecision.evaluation.rationale).toContain('without meaningful improvement');
  });

  it('rethrows aborts instead of converting them into unavailable pilot decisions', async () => {
    const abortController = new AbortController();
    const abortError = new Error('Pilot review cancelled by the user.');
    abortError.name = 'AbortError';
    abortController.abort(abortError);

    await expect(evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Candidate outcome ready for pilot review.',
      },
      providerContext: makeProviderContext(),
      signal: abortController.signal,
    })).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Pilot review cancelled by the user.',
    });
  });

  it('blocks final delivery when no live pilot provider context is available', async () => {
    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        summary: {
          assistantTurns: 2,
          startedTools: 2,
          completedTools: 2,
          failedTools: 0,
          spawnedSubAgents: 0,
        },
      }),
      workers: [],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user', role: 'user', content: 'Fix the workflow and verify it.', timestamp: 10 }),
          makeMessage({
            id: 'msg-assistant',
            role: 'assistant',
            content: 'Launching a worker.',
            timestamp: 20,
            toolCalls: [
              {
                id: 'tc-1',
                name: 'sessions_spawn',
                arguments: '{}',
                status: 'pending',
              },
            ],
          }),
          makeMessage({
            id: 'msg-tool',
            role: 'tool',
            content: 'Verified the fix directly with run_tests.',
            toolCallId: 'tc-verify',
            timestamp: 30,
            toolCalls: [
              {
                id: 'tc-verify',
                name: 'run_tests',
                arguments: '{}',
                status: 'completed',
              },
            ],
          }),
        ],
        lastNonEmptyAssistantContent: 'Here is the final answer.',
        lastSubstantiveResult: 'Verified the fix directly with run_tests.',
        resultPreviews: [{ sourceName: 'run_tests', preview: 'Verified the fix directly with run_tests.' }],
        toolsUsed: ['sessions_spawn', 'run_tests'],
        hasIncompleteToolCalls: false,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
    });

    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.outcome.status).toBe('cancelled');
    expect(decision.evaluation.source).toBe('unavailable');
    expect(decision.evaluation.fallbackReason).toBe('no_provider_context');
    expect(decision.checkpointTitle).toBe('Pilot blocked finalization');
  });

  it('uses the structured evaluator to approve finalization with explicit scores', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'pilot-call-1',
            function: {
              name: 'pilot_report',
              arguments: JSON.stringify({
                recommendedAction: 'finalize',
                controlAction: 'accept',
                completionScore: 5,
                adherenceScore: 4,
                evidenceScore: 5,
                processScore: 4,
                approved: true,
                confidence: 'high',
                summary: 'The run is complete and verified.',
                rationale: 'All requested work is done and backed by verified evidence.',
                strengths: ['Verified evidence captured.'],
                gaps: [],
                nextActions: [],
                criterionEvaluations: [
                  {
                    criterion: 'Produce the requested deliverable.',
                    score: 5,
                    status: 'met',
                    rationale: 'The deliverable exists.',
                  },
                  {
                    criterion: 'Verify the result before finalizing.',
                    score: 4,
                    status: 'met',
                    rationale: 'The result is verified.',
                  },
                ],
              }),
            },
          }],
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      structuredOutput: expect.objectContaining({
        name: 'pilot_report',
        mimeType: 'application/json',
        strict: true,
        schema: expect.any(Object),
      }),
      temperature: 0,
    }));
    expect(mockSendMessage.mock.calls[0]?.[1]?.tools).toBeUndefined();
    expect(mockSendMessage.mock.calls[0]?.[1]?.toolChoice).toBeUndefined();
    expect(decision.action).toBe('finalize');
    expect(decision.outcome.status).toBe('completed');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
    expect(decision.evaluation.overallScore).toBe(18);
    expect(decision.evaluation.source).toBe('provider');
    expect(decision.evaluation.criterionEvaluations[0]?.score).toBe(5);
    expect(decision.checkpointTitle).toBe('Pilot approved finalization');
  });

  it('downgrades live pilot approval when provider-comparison claims are uncited and overconfident', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({
            recommendedAction: 'finalize',
            controlAction: 'accept',
            completionScore: 5,
            adherenceScore: 5,
            evidenceScore: 5,
            processScore: 4,
            approved: true,
            confidence: 'high',
            summary: 'The run is complete and verified.',
            rationale: 'All requested work is done and backed by verified evidence.',
            strengths: ['Verified evidence captured.'],
            gaps: [],
            nextActions: [],
            criterionEvaluations: [
              {
                criterion: 'Base the comparison on official provider documentation.',
                score: 5,
                status: 'met',
                rationale: 'The comparison is complete.',
              },
              {
                criterion: 'Cite the supporting sources in the final answer.',
                score: 5,
                status: 'met',
                rationale: 'The answer is ready to ship.',
              },
            ],
          }),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Compare OpenAI, Anthropic, and Gemini using official docs.',
        plan: {
          objective: 'Compare OpenAI, Anthropic, and Gemini using official docs.',
          successCriteria: [
            'Base the comparison on official provider documentation.',
            'Cite the supporting sources in the final answer.',
          ],
          stopConditions: ['Stop when the provider comparison is complete and cited.'],
          workstreams: [],
          updatedAt: 1,
        },
      }),
      workers: [makeWorker()],
      evidence: makeEvidence({
        originalPrompt: 'Compare OpenAI, Anthropic, and Gemini using official docs.',
        transcriptMessages: [
          makeMessage({ id: 'msg-user', role: 'user', content: 'Compare OpenAI, Anthropic, and Gemini using official docs.', timestamp: 10 }),
          makeMessage({
            id: 'msg-assistant',
            role: 'assistant',
            content: 'OpenAI can reduce latency by up to 40% and is the clear leader for orchestration.',
            timestamp: 20,
          }),
        ],
        lastNonEmptyAssistantContent: 'OpenAI can reduce latency by up to 40% and is the clear leader for orchestration.',
        lastSubstantiveResult: 'OpenAI can reduce latency by up to 40% and is the clear leader for orchestration.',
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    const requestMessages = mockSendMessage.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(requestMessages[1]?.content).toContain('provider-specific claims in the user-visible answer must cite named sources or URLs');
    expect(requestMessages[1]?.content).toContain('Current research integrity gaps:');
    expect(decision.action).toBe('resume');
    expect(decision.checkpointTitle).toBe(PILOT_REVIEW_CHECKPOINT_TITLE);
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.controlAction).toBe('continue');
    expect(decision.evaluation.summary).toBe('Pilot found uncited or unsupported research claims that must be corrected before final delivery.');
    expect(decision.evaluation.gaps).toEqual(expect.arrayContaining([
      'The user-visible answer makes provider-specific research claims without citing named sources or URLs.',
      'The user-visible answer includes quantitative provider claims without direct source attribution.',
    ]));
    expect(decision.evaluation.nextActions).toEqual(expect.arrayContaining([
      'Revise the existing draft to cite named official sources or URLs for each provider-specific claim.',
    ]));
  });

  it('approves an early clarification response for a low-signal request', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(makePilotPayload(DEFAULT_SUCCESS_CRITERIA, {
            summary: 'The response handled the turn correctly.',
            rationale: 'The assistant handled the request safely.',
          })),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Clarify the user request.',
        summary: {
          assistantTurns: 1,
          startedTools: 0,
          completedTools: 0,
          failedTools: 0,
          spawnedSubAgents: 0,
        },
      }),
      workers: [],
      evidence: makeEvidence({
        originalPrompt: '---',
        transcriptMessages: [
          makeMessage({ id: 'msg-user-low-signal', role: 'user', content: '---', timestamp: 10 }),
          makeMessage({
            id: 'msg-assistant-low-signal',
            role: 'assistant',
            content: 'Please clarify the task and tell me the concrete outcome you want.',
            timestamp: 20,
          }),
        ],
        lastNonEmptyAssistantContent: 'Please clarify the task and tell me the concrete outcome you want.',
        lastSubstantiveResult: '',
        resultPreviews: [],
        toolsUsed: [],
        hasIncompleteToolCalls: false,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'The assistant stopped early and asked the user to clarify the request.',
      },
      providerContext: makeProviderContext(),
    });

    const requestMessages = mockSendMessage.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(requestMessages[1]?.content).toContain('Request governance assessment:');
    expect(requestMessages[1]?.content).toContain('Approve only if the workflow stopped early and asked the user for the missing details');
    expect(decision.action).toBe('finalize');
    expect(decision.outcome.status).toBe('completed');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
    expect(decision.evaluation.summary).toContain('early stop');
  });

  it('queues a correction cycle when a low-signal request was handled as real work', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(makePilotPayload(DEFAULT_SUCCESS_CRITERIA, {
            summary: 'The run is complete and verified.',
            rationale: 'All requested work is done.',
          })),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Handle the request safely.',
        summary: {
          assistantTurns: 2,
          startedTools: 1,
          completedTools: 1,
          failedTools: 0,
          spawnedSubAgents: 0,
        },
      }),
      workers: [],
      evidence: makeEvidence({
        originalPrompt: 'rename',
        transcriptMessages: [
          makeMessage({ id: 'msg-user-low-signal-work', role: 'user', content: 'rename', timestamp: 10 }),
          makeMessage({
            id: 'msg-assistant-low-signal-work',
            role: 'assistant',
            content: 'I already audited the repo and picked a variable to rename.',
            timestamp: 20,
          }),
        ],
        lastNonEmptyAssistantContent: 'I already audited the repo and picked a variable to rename.',
        lastSubstantiveResult: 'Read 14 files and picked a variable to rename.',
        resultPreviews: [{ sourceName: 'read_file', preview: 'Read 14 files and picked a variable to rename.' }],
        toolsUsed: ['read_file'],
        hasIncompleteToolCalls: false,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'The workflow completed after repo inspection.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.checkpointTitle).toBe(PILOT_REVIEW_CHECKPOINT_TITLE);
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.controlAction).toBe('continue');
    expect(decision.evaluation.summary).toContain('low-signal request');
    expect(decision.evaluation.nextActions).toEqual(expect.arrayContaining([
      'Stop the workflow now and ask the user for the concrete task or missing details instead of continuing autonomously.',
    ]));
  });

  it('approves a verified direct lookup answer even if the provider asks for more work', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(makePilotPayload(DEFAULT_SUCCESS_CRITERIA, {
            recommendedAction: 'continue',
            controlAction: 'continue',
            completionScore: 2,
            adherenceScore: 2,
            evidenceScore: 2,
            processScore: 2,
            approved: false,
            summary: 'Pilot found remaining gaps that require more work.',
            rationale: 'Keep working.',
            gaps: ['Keep working.'],
            nextActions: ['Run another tool call.'],
            criterionEvaluations: DEFAULT_SUCCESS_CRITERIA.map((criterion) => ({
              criterion,
              score: 2,
              status: 'partial',
              rationale: 'More work is still needed.',
            })),
          })),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Answer the direct weather question.',
        summary: {
          assistantTurns: 1,
          startedTools: 1,
          completedTools: 1,
          failedTools: 0,
          spawnedSubAgents: 0,
        },
      }),
      workers: [],
      evidence: makeEvidence({
        originalPrompt: 'Is it cold outside in Cairo right now?',
        transcriptMessages: [
          makeMessage({ id: 'msg-user-direct-weather', role: 'user', content: 'Is it cold outside in Cairo right now?', timestamp: 10 }),
          makeMessage({
            id: 'msg-assistant-direct-weather',
            role: 'assistant',
            content: 'Yes. It is currently 14 C in Cairo, so it is cool outside rather than very cold.',
            timestamp: 20,
          }),
        ],
        lastNonEmptyAssistantContent: 'Yes. It is currently 14 C in Cairo, so it is cool outside rather than very cold.',
        lastSubstantiveResult: '{"temperatureC":14,"condition":"clear"}',
        resultPreviews: [{ sourceName: 'weather_lookup', preview: 'Cairo weather: 14 C and clear.' }],
        toolsUsed: ['weather_lookup'],
        hasIncompleteToolCalls: false,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'Answered the direct weather question.',
      },
      providerContext: makeProviderContext(),
    });

    const requestMessages = mockSendMessage.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(requestMessages[1]?.content).toContain('Approve only if the response answered the direct question succinctly');
    expect(decision.action).toBe('finalize');
    expect(decision.outcome.status).toBe('completed');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
    expect(decision.evaluation.summary).toContain('direct lookup answer');
  });

  it('forces a text-only correction when a direct lookup already has verified evidence', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(makePilotPayload(DEFAULT_SUCCESS_CRITERIA, {
            recommendedAction: 'continue',
            controlAction: 'continue',
            completionScore: 2,
            adherenceScore: 2,
            evidenceScore: 2,
            processScore: 2,
            approved: false,
            summary: 'Pilot found remaining gaps that require more work.',
            rationale: 'Keep working.',
            gaps: ['Keep working.'],
            nextActions: ['Run another tool call.'],
            criterionEvaluations: DEFAULT_SUCCESS_CRITERIA.map((criterion) => ({
              criterion,
              score: 2,
              status: 'partial',
              rationale: 'More work is still needed.',
            })),
          })),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Answer the direct weather question.',
        summary: {
          assistantTurns: 1,
          startedTools: 1,
          completedTools: 1,
          failedTools: 0,
          spawnedSubAgents: 0,
        },
      }),
      workers: [],
      evidence: makeEvidence({
        originalPrompt: 'Is it cold outside in Cairo right now?',
        transcriptMessages: [
          makeMessage({ id: 'msg-user-direct-weather-repair', role: 'user', content: 'Is it cold outside in Cairo right now?', timestamp: 10 }),
          makeMessage({
            id: 'msg-assistant-direct-weather-repair',
            role: 'assistant',
            content: 'I will inspect the live weather first.',
            timestamp: 20,
          }),
        ],
        lastNonEmptyAssistantContent: 'I will inspect the live weather first.',
        lastSubstantiveResult: '{"temperatureC":14,"condition":"clear"}',
        resultPreviews: [{ sourceName: 'weather_lookup', preview: 'Cairo weather: 14 C and clear.' }],
        toolsUsed: ['weather_lookup'],
        hasIncompleteToolCalls: false,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'The weather lookup finished, but the answer was not delivered cleanly.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.disableToolsOnResume).toBe(true);
    expect(decision.reviewPrompt).toContain('Tool use is disabled for this continuation.');
    expect(decision.reviewUserPrompt).toContain('Tools are disabled for this continuation.');
    expect(decision.evaluation.nextActions).toEqual(expect.arrayContaining([
      'Do not call tools again.',
      'Answer the user directly from the verified evidence already captured for this request.',
    ]));
  });

  it('blocks repeated non-improving direct lookup correction cycles after one prior review', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(makePilotPayload(DEFAULT_SUCCESS_CRITERIA, {
            recommendedAction: 'continue',
            controlAction: 'continue',
            completionScore: 2,
            adherenceScore: 2,
            evidenceScore: 2,
            processScore: 2,
            approved: false,
            summary: 'Pilot found remaining gaps that require more work.',
            rationale: 'Keep working.',
            gaps: ['Keep working.'],
            nextActions: ['Run another tool call.'],
            criterionEvaluations: DEFAULT_SUCCESS_CRITERIA.map((criterion) => ({
              criterion,
              score: 2,
              status: 'partial',
              rationale: 'More work is still needed.',
            })),
          })),
        },
      }],
    });

    const firstDecision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Answer the direct weather question.',
        summary: {
          assistantTurns: 1,
          startedTools: 1,
          completedTools: 1,
          failedTools: 0,
          spawnedSubAgents: 0,
        },
      }),
      workers: [],
      evidence: makeEvidence({
        originalPrompt: 'Is it cold outside in Cairo right now?',
        transcriptMessages: [
          makeMessage({ id: 'msg-user-direct-weather-repeat-1', role: 'user', content: 'Is it cold outside in Cairo right now?', timestamp: 10 }),
          makeMessage({
            id: 'msg-assistant-direct-weather-repeat-1',
            role: 'assistant',
            content: 'I will inspect the live weather first.',
            timestamp: 20,
          }),
        ],
        lastNonEmptyAssistantContent: 'I will inspect the live weather first.',
        lastSubstantiveResult: '{"temperatureC":14,"condition":"clear"}',
        resultPreviews: [{ sourceName: 'weather_lookup', preview: 'Cairo weather: 14 C and clear.' }],
        toolsUsed: ['weather_lookup'],
        hasIncompleteToolCalls: false,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'The weather lookup finished, but the answer was not delivered cleanly.',
      },
      providerContext: makeProviderContext(),
    });

    const secondDecision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Answer the direct weather question.',
        checkpoints: [{
          id: 'cp-direct-1',
          timestamp: 30,
          kind: 'run',
          title: PILOT_REVIEW_CHECKPOINT_TITLE,
          detail: 'Pilot correction cycle 1 asked for a direct answer from the verified weather lookup.',
        }],
        latestPilotEvaluation: firstDecision.evaluation,
        summary: {
          assistantTurns: 2,
          startedTools: 1,
          completedTools: 1,
          failedTools: 0,
          spawnedSubAgents: 0,
        },
      }),
      workers: [],
      evidence: makeEvidence({
        originalPrompt: 'Is it cold outside in Cairo right now?',
        transcriptMessages: [
          makeMessage({ id: 'msg-user-direct-weather-repeat-2', role: 'user', content: 'Is it cold outside in Cairo right now?', timestamp: 40 }),
          makeMessage({
            id: 'msg-assistant-direct-weather-repeat-2',
            role: 'assistant',
            content: 'I will inspect the live weather first.',
            timestamp: 50,
          }),
        ],
        lastNonEmptyAssistantContent: 'I will inspect the live weather first.',
        lastSubstantiveResult: '{"temperatureC":14,"condition":"clear"}',
        resultPreviews: [{ sourceName: 'weather_lookup', preview: 'Cairo weather: 14 C and clear.' }],
        toolsUsed: ['weather_lookup'],
        hasIncompleteToolCalls: false,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'The weather lookup finished, but the answer is still missing.',
      },
      providerContext: makeProviderContext(),
    });

    expect(firstDecision.action).toBe('resume');
    expect(firstDecision.disableToolsOnResume).toBe(true);
    expect(secondDecision.action).toBe('finalize');
    expect(secondDecision.checkpointTitle).toBe('Pilot blocked finalization');
    expect(secondDecision.outcome.status).toBe('cancelled');
    expect(secondDecision.evaluation.recommendedAction).toBe('blocked');
    expect(secondDecision.evaluation.summary).toContain('stopped autonomous correction');
  });

  it('queues a correction cycle when a simple task request includes unreasonable process and the response fails to challenge it', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(makePilotPayload(DEFAULT_SUCCESS_CRITERIA, {
            summary: 'The run is complete and verified.',
            rationale: 'All requested work is done.',
          })),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Fix the typo safely.',
        summary: {
          assistantTurns: 2,
          startedTools: 2,
          completedTools: 2,
          failedTools: 0,
          spawnedSubAgents: 1,
        },
      }),
      workers: [makeWorker()],
      evidence: makeEvidence({
        originalPrompt: 'Fix the typo, but spawn 4 workers and audit the entire codebase first.',
        transcriptMessages: [
          makeMessage({
            id: 'msg-user-overscoped',
            role: 'user',
            content: 'Fix the typo, but spawn 4 workers and audit the entire codebase first.',
            timestamp: 10,
          }),
          makeMessage({
            id: 'msg-assistant-overscoped',
            role: 'assistant',
            content: 'I launched the workers, audited the whole repo, and fixed the typo.',
            timestamp: 20,
          }),
        ],
        lastNonEmptyAssistantContent: 'I launched the workers, audited the whole repo, and fixed the typo.',
        lastSubstantiveResult: 'Repo audit complete; typo fixed.',
        resultPreviews: [{ sourceName: 'worker', preview: 'Repo audit complete; typo fixed.' }],
        toolsUsed: ['sessions_spawn', 'read_file'],
        hasIncompleteToolCalls: false,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'The workflow completed after a full repo audit.',
      },
      providerContext: makeProviderContext(),
    });

    const requestMessages = mockSendMessage.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(requestMessages[1]?.content).toContain('Approve only if the response explicitly criticized the unreasonable ask');
    expect(decision.action).toBe('resume');
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.summary).toContain('unreasonable-scope request');
    expect(decision.evaluation.nextActions).toEqual(expect.arrayContaining([
      'Criticize the unreasonable effort or process request explicitly and state the smaller reasonable scope you will handle instead.',
    ]));
  });

  it('includes structured workflow evidence in the live pilot prompt', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({
            recommendedAction: 'continue',
            controlAction: 'continue',
            completionScore: 4,
            adherenceScore: 4,
            evidenceScore: 4,
            processScore: 4,
            approved: false,
            confidence: 'medium',
            summary: 'Pilot needs one more correction cycle.',
            rationale: 'The structured evidence is strong, but the workflow still needs another pass.',
            strengths: ['Strong structured evidence ledger.'],
            gaps: ['One remaining correction is needed.'],
            nextActions: ['Close the remaining correction and keep the existing verified draft.'],
            criterionEvaluations: [
              { criterion: 'Produce the requested deliverable.', score: 4, status: 'partial', rationale: 'Close to complete.' },
              { criterion: 'Verify the result before finalizing.', score: 4, status: 'partial', rationale: 'Verified, but not final.' },
            ],
          }),
        },
      }],
    });

    await evaluateAgentRunWithPilot({
      run: makeRun({
        evidence: [
          {
            id: 'ev-structured-1',
            kind: 'artifact',
            status: 'verified',
            recorder: 'worker',
            title: 'Patched store file',
            content: 'Updated the chat store to persist structured workflow evidence.',
            artifactWorkspacePath: 'src/store/useChatStore.ts',
            createdAt: 10,
            updatedAt: 20,
          },
        ],
      }),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    const requestMessages = mockSendMessage.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(requestMessages[1]?.content).toContain('Structured workflow evidence:');
    expect(requestMessages[1]?.content).toContain('[verified artifact] Patched store file');
    expect(requestMessages[1]?.content).toContain('artifact=src/store/useChatStore.ts');
  });

  it('downgrades inconsistent finalize signals to continue instead of blocking the workflow', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({
            recommendedAction: 'finalize',
            controlAction: 'accept',
            completionScore: 4,
            adherenceScore: 4,
            evidenceScore: 3,
            processScore: 3,
            approved: false,
            confidence: 'medium',
            summary: 'Verification is still incomplete, so the workflow should continue.',
            rationale: 'The deliverable exists, but verified evidence is not strong enough to finalize safely.',
            strengths: ['The implementation draft exists.'],
            gaps: ['Verification is still incomplete.'],
            nextActions: ['Run targeted verification before final delivery.'],
            criterionEvaluations: [
              {
                criterion: 'Produce the requested deliverable.',
                score: 4,
                status: 'met',
                rationale: 'The deliverable exists.',
              },
              {
                criterion: 'Verify the result before finalizing.',
                score: 3,
                status: 'partial',
                rationale: 'Verification is still incomplete.',
              },
            ],
          }),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.checkpointTitle).toBe(PILOT_REVIEW_CHECKPOINT_TITLE);
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.recommendedAction).toBe('continue');
    expect(decision.evaluation.controlAction).toBe('continue');
    expect(decision.evaluation.summary).toBe('Verification is still incomplete, so the workflow should continue.');
  });

  it('uses structured JSON pilot evaluation for Gemini without forcing tool calls or temperature overrides', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({
            recommendedAction: 'finalize',
            controlAction: 'accept',
            completionScore: 5,
            adherenceScore: 4,
            evidenceScore: 5,
            processScore: 4,
            approved: true,
            confidence: 'high',
            summary: 'The run is complete and verified.',
            rationale: 'All requested work is done and backed by verified evidence.',
            strengths: ['Verified evidence captured.'],
            gaps: [],
            nextActions: [],
            criterionEvaluations: [
              {
                criterion: 'Produce the requested deliverable.',
                score: 5,
                status: 'met',
                rationale: 'The deliverable exists.',
              },
              {
                criterion: 'Verify the result before finalizing.',
                score: 4,
                status: 'met',
                rationale: 'The result is verified.',
              },
            ],
          }),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeGeminiProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      model: 'gemini-3-flash-preview',
      structuredOutput: expect.objectContaining({
        name: 'pilot_report',
        mimeType: 'application/json',
        strict: true,
      }),
    }));
    expect(mockSendMessage.mock.calls[0]?.[1]?.temperature).toBeUndefined();
    expect(mockSendMessage.mock.calls[0]?.[1]?.tools).toBeUndefined();
    expect(mockSendMessage.mock.calls[0]?.[1]?.toolChoice).toBeUndefined();
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.source).toBe('provider');
    expect(decision.evaluation.approved).toBe(true);
  });

  it('reports pilot evaluator token usage for successful structured reviews', async () => {
    const onUsage = jest.fn();
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'pilot-call-usage-1',
            function: {
              name: 'pilot_report',
              arguments: JSON.stringify({
                recommendedAction: 'finalize',
                controlAction: 'accept',
                completionScore: 5,
                adherenceScore: 4,
                evidenceScore: 5,
                processScore: 4,
                approved: true,
                confidence: 'high',
                summary: 'The run is complete and verified.',
                rationale: 'All requested work is done and backed by verified evidence.',
                strengths: ['Verified evidence captured.'],
                gaps: [],
                nextActions: [],
                criterionEvaluations: [
                  {
                    criterion: 'Produce the requested deliverable.',
                    score: 5,
                    status: 'met',
                    rationale: 'The deliverable exists.',
                  },
                  {
                    criterion: 'Verify the result before finalizing.',
                    score: 4,
                    status: 'met',
                    rationale: 'The result is verified.',
                  },
                ],
              }),
            },
          }],
        },
      }],
      usage: {
        prompt_tokens: 90,
        completion_tokens: 30,
        total_tokens: 120,
      },
    });

    await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
      onUsage,
    });

    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4',
      inputTokens: 90,
      outputTokens: 30,
      totalTokens: 120,
    }));
  });

  it('reports usage for each pilot retry attempt', async () => {
    const onUsage = jest.fn();
    mockSendMessage
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: 'This is not machine readable.',
          },
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 40,
          total_tokens: 140,
        },
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'pilot-call-retry-1',
              function: {
                name: 'pilot_report',
                arguments: JSON.stringify({
                  recommendedAction: 'finalize',
                  controlAction: 'accept',
                  completionScore: 5,
                  adherenceScore: 4,
                  evidenceScore: 5,
                  processScore: 4,
                  approved: true,
                  confidence: 'high',
                  summary: 'The run is complete and verified.',
                  rationale: 'All requested work is done and backed by verified evidence.',
                  strengths: ['Verified evidence captured.'],
                  gaps: [],
                  nextActions: [],
                  criterionEvaluations: [
                    {
                      criterion: 'Produce the requested deliverable.',
                      score: 5,
                      status: 'met',
                      rationale: 'The deliverable exists.',
                    },
                    {
                      criterion: 'Verify the result before finalizing.',
                      score: 4,
                      status: 'met',
                      rationale: 'The result is verified.',
                    },
                  ],
                }),
              },
            }],
          },
        }],
        usage: {
          prompt_tokens: 80,
          completion_tokens: 20,
          total_tokens: 100,
        },
      });

    await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
      onUsage,
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      model: 'gpt-5.4',
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
    }));
    expect(onUsage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      model: 'gpt-5.4',
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
    }));
  });

  it('continues the workflow heuristically when the evaluator returns no structured result and evidence is still weak', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker({ output: '', lastToolResultPreview: undefined, currentActivity: undefined })],
      evidence: makeEvidence({
        lastSubstantiveResult: '',
        resultPreviews: [],
        toolsUsed: [],
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.checkpointTitle).toBe(PILOT_REVIEW_CHECKPOINT_TITLE);
    expect(decision.evaluation.evaluatorVersion).toContain('heuristic');
    expect(decision.evaluation.source).toBe('heuristic');
    expect(decision.evaluation.fallbackReason).toBe('response_unparseable');
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.controlAction).toBe('continue');
  });

  it('blocks final delivery when live pilot evaluation remains unavailable after a strong heuristic review', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('finalize');
    expect(decision.outcome.status).toBe('cancelled');
    expect(decision.checkpointTitle).toBe('Pilot blocked finalization');
    expect(decision.evaluation.evaluatorVersion).toContain('unavailable');
    expect(decision.evaluation.source).toBe('unavailable');
    expect(decision.evaluation.fallbackReason).toBe('response_unparseable');
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.controlAction).toBe('block');
    expect(decision.evaluation.approvalThreshold).toBe(18);
    expect(decision.evaluation.summary).toContain('live pilot approval is unavailable');
  });

  it('keeps heuristic fallback in continue mode when provider-comparison claims are uncited', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        goal: 'Compare OpenAI, Anthropic, and Gemini using official docs.',
        plan: {
          objective: 'Compare OpenAI, Anthropic, and Gemini using official docs.',
          successCriteria: [
            'Base the comparison on official provider documentation.',
            'Cite the supporting sources in the final answer.',
          ],
          stopConditions: ['Stop when the provider comparison is complete and cited.'],
          workstreams: [],
          updatedAt: 1,
        },
      }),
      workers: [makeWorker()],
      evidence: makeEvidence({
        originalPrompt: 'Compare OpenAI, Anthropic, and Gemini using official docs.',
        transcriptMessages: [
          makeMessage({ id: 'msg-user', role: 'user', content: 'Compare OpenAI, Anthropic, and Gemini using official docs.', timestamp: 10 }),
          makeMessage({
            id: 'msg-assistant',
            role: 'assistant',
            content: 'OpenAI can reduce latency by up to 40% and is the clear leader for orchestration.',
            timestamp: 20,
          }),
        ],
        lastNonEmptyAssistantContent: 'OpenAI can reduce latency by up to 40% and is the clear leader for orchestration.',
        lastSubstantiveResult: 'Verified provider findings.',
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.checkpointTitle).toBe(PILOT_REVIEW_CHECKPOINT_TITLE);
    expect(decision.evaluation.evaluatorVersion).toContain('heuristic');
    expect(decision.evaluation.source).toBe('heuristic');
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.controlAction).toBe('continue');
    expect(decision.evaluation.summary).toContain('Heuristic pilot review found uncited or unsupported research claims before final delivery.');
    expect(decision.evaluation.gaps).toEqual(expect.arrayContaining([
      'The user-visible answer makes provider-specific research claims without citing named sources or URLs.',
    ]));
  });

  it('falls back to heuristic continuation when the live pilot request fails on a non-trivial solo run', async () => {
    mockSendMessage.mockRejectedValue(new Error('LLM API error 503: upstream unavailable'));

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        summary: {
          assistantTurns: 2,
          startedTools: 2,
          completedTools: 2,
          failedTools: 0,
          spawnedSubAgents: 0,
        },
      }),
      workers: [],
      evidence: makeEvidence({
        toolsUsed: ['web_search', 'read_file'],
        resultPreviews: [{ sourceName: 'tool', preview: 'Verified repository findings.' }],
        lastSubstantiveResult: 'Verified repository findings.',
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.checkpointTitle).toBe(PILOT_REVIEW_CHECKPOINT_TITLE);
    expect(decision.evaluation.evaluatorVersion).toContain('heuristic');
    expect(decision.evaluation.source).toBe('heuristic');
    expect(decision.evaluation.fallbackReason).toBe('request_failed');
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.controlAction).toBe('continue');
    expect(decision.evaluation.rationale).toContain('LLM API error 503');
  });

  it('uses a raw JSON third-pass fallback before blocking finalization', async () => {
    mockSendMessage
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify(makePilotPayload()),
          },
        }],
      });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(3);
    expect(mockSendMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      structuredOutput: expect.objectContaining({
        name: 'pilot_report',
        mimeType: 'application/json',
        strict: true,
      }),
    }));
    expect(mockSendMessage.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      structuredOutput: expect.objectContaining({
        name: 'pilot_report',
        mimeType: 'application/json',
        strict: true,
      }),
    }));
    expect(mockSendMessage.mock.calls[2]?.[1]?.structuredOutput).toBeUndefined();
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.evaluatorVersion).toBe('pilot-v2');
    expect(decision.evaluation.approved).toBe(true);
  });

  it('keeps retrying with raw JSON after a structured-output request failure', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new Error('LLM API error 503: upstream unavailable'))
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify(makePilotPayload()),
          },
        }],
      });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      maxTokens: 1200,
      structuredOutput: expect.objectContaining({
        name: 'pilot_report',
        mimeType: 'application/json',
        strict: true,
      }),
    }));
    expect(mockSendMessage.mock.calls[1]?.[1]?.maxTokens).toBe(1080);
    expect(mockSendMessage.mock.calls[1]?.[1]?.structuredOutput).toBeUndefined();
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.source).toBe('provider');
    expect(decision.evaluation.approved).toBe(true);
  });

  it('scales pilot evaluator max tokens for larger success-criteria sets', async () => {
    const successCriteria = [
      'Produce the requested deliverable.',
      'Verify the result before finalizing.',
      'Document the behavioral changes.',
      'Cover the regression with tests.',
      'Confirm provider parity.',
      'Keep the implementation maintainable.',
    ];

    mockSendMessage.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(makePilotPayload(successCriteria)),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun({
        plan: {
          objective: 'Ship a production-ready fix.',
          successCriteria,
          stopConditions: ['Stop when the deliverable is complete and verified.'],
          workstreams: [],
          updatedAt: 1,
        },
      }),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      maxTokens: 1840,
      structuredOutput: expect.objectContaining({
        name: 'pilot_report',
      }),
    }));
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
  });

  it('uses a tool-call fourth-pass fallback when JSON retries stay unparseable', async () => {
    mockSendMessage
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            providerReplay: {
              geminiParts: [{
                functionCall: {
                  name: 'pilot_report',
                  args: {
                    recommendedAction: 'finalize',
                    controlAction: 'accept',
                    completionScore: 5,
                    adherenceScore: 4,
                    evidenceScore: 5,
                    processScore: 4,
                    approved: true,
                    confidence: 'high',
                    summary: 'The run is complete and verified.',
                    rationale: 'All requested work is done and backed by verified evidence.',
                    strengths: ['Verified evidence captured.'],
                    gaps: [],
                    nextActions: [],
                    criterionEvaluations: [
                      {
                        criterion: 'Produce the requested deliverable.',
                        score: 5,
                        status: 'met',
                        rationale: 'The deliverable exists.',
                      },
                      {
                        criterion: 'Verify the result before finalizing.',
                        score: 4,
                        status: 'met',
                        rationale: 'The result is verified.',
                      },
                    ],
                  },
                },
              }],
            },
          },
        }],
      });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeGeminiProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(4);
    expect(mockSendMessage.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      tools: [expect.objectContaining({
        name: 'pilot_report',
        strict: true,
      })],
      toolChoice: {
        type: 'tool',
        name: 'pilot_report',
        disableParallelToolUse: true,
      },
    }));
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.evaluatorVersion).toBe('pilot-v2');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.source).toBe('provider');
  });

  it('salvages a recoverable provider payload after strict retries when only secondary fields are missing', async () => {
    mockSendMessage
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'pilot-call-recoverable-fallback',
              function: {
                name: 'pilot_report',
                arguments: JSON.stringify({
                  recommendedAction: 'finalize',
                  controlAction: 'accept',
                  completionScore: 5,
                  adherenceScore: 4,
                  evidenceScore: 5,
                  processScore: 4,
                  approved: true,
                  summary: 'The run is complete and verified.',
                  rationale: 'All requested work is done and backed by verified evidence.',
                  criterionEvaluations: [
                    {
                      criterion: 'Produce the requested deliverable.',
                      score: 5,
                      status: 'met',
                      rationale: 'The deliverable exists.',
                    },
                    {
                      criterion: 'Verify the result before finalizing.',
                      score: 4,
                      status: 'met',
                      rationale: 'The result is verified.',
                    },
                  ],
                }),
              },
            }],
          },
        }],
      });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeGeminiProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(4);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.source).toBe('provider');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.summary).toBe('The run is complete and verified.');
    expect(decision.evaluation.strengths).toEqual([]);
    expect(decision.evaluation.gaps).toEqual([]);
    expect(decision.evaluation.nextActions).toEqual([]);
    expect(decision.evaluation.confidence).toBe('medium');
  });

  it('rejects parseable but incomplete Anthropic pilot payloads and continues to the tool fallback', async () => {
    mockSendMessage
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              recommendedAction: 'continue',
              controlAction: 'continue',
              summary: 'Pilot found remaining gaps that require more work.',
              rationale: 'Keep going.',
            }),
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              recommendedAction: 'continue',
              controlAction: 'continue',
              summary: 'Pilot found remaining gaps that require more work.',
              rationale: 'Keep going.',
            }),
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              recommendedAction: 'continue',
              controlAction: 'continue',
              summary: 'Pilot found remaining gaps that require more work.',
              rationale: 'Keep going.',
            }),
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'pilot-call-anthropic-fallback',
              function: {
                name: 'pilot_report',
                arguments: JSON.stringify({
                  recommendedAction: 'finalize',
                  controlAction: 'accept',
                  completionScore: 5,
                  adherenceScore: 4,
                  evidenceScore: 5,
                  processScore: 4,
                  approved: true,
                  confidence: 'high',
                  summary: 'The run is complete and verified.',
                  rationale: 'All requested work is done and backed by verified evidence.',
                  strengths: ['Verified evidence captured.'],
                  gaps: [],
                  nextActions: [],
                  criterionEvaluations: [
                    {
                      criterion: 'Produce the requested deliverable.',
                      score: 5,
                      status: 'met',
                      rationale: 'The deliverable exists.',
                    },
                    {
                      criterion: 'Verify the result before finalizing.',
                      score: 4,
                      status: 'met',
                      rationale: 'The result is verified.',
                    },
                  ],
                }),
              },
            }],
          },
        }],
      });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeAnthropicProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(4);
    expect(mockSendMessage.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      tools: [expect.objectContaining({
        name: 'pilot_report',
        strict: true,
      })],
      toolChoice: {
        type: 'tool',
        name: 'pilot_report',
        disableParallelToolUse: true,
      },
    }));
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.source).toBe('provider');
    expect(decision.evaluation.summary).toBe('The run is complete and verified.');
  });

  it('re-runs structured pilot evaluation when the cached same-state review used an unavailable fallback', async () => {
    mockSendMessage.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
        },
      }],
    });

    const fallbackDecision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(fallbackDecision.evaluation.evaluatorVersion).toContain('unavailable');
    expect(fallbackDecision.evaluation.source).toBe('unavailable');
    expect(fallbackDecision.evaluation.fallbackReason).toBe('response_unparseable');

    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'pilot-call-structured',
            function: {
              name: 'pilot_report',
              arguments: JSON.stringify({
                recommendedAction: 'finalize',
                controlAction: 'accept',
                completionScore: 5,
                adherenceScore: 4,
                evidenceScore: 5,
                processScore: 4,
                approved: true,
                confidence: 'high',
                summary: 'The run is complete and verified.',
                rationale: 'All requested work is done and backed by verified evidence.',
                strengths: ['Verified evidence captured.'],
                gaps: [],
                nextActions: [],
                criterionEvaluations: [
                  {
                    criterion: 'Produce the requested deliverable.',
                    score: 5,
                    status: 'met',
                    rationale: 'The deliverable exists.',
                  },
                  {
                    criterion: 'Verify the result before finalizing.',
                    score: 4,
                    status: 'met',
                    rationale: 'The result is verified.',
                  },
                ],
              }),
            },
          }],
        },
      }],
    });

    const structuredDecision = await evaluateAgentRunWithPilot({
      run: makeRun({
        latestPilotEvaluation: fallbackDecision.evaluation,
      }),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(structuredDecision.evaluation.evaluatorVersion).toBe('pilot-v2');
    expect(structuredDecision.evaluation.approved).toBe(true);
    expect(structuredDecision.action).toBe('finalize');
  });

  it('keeps the workflow running heuristically when live pilot evaluation is unavailable while work is still in flight', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker({ status: 'running', output: '', currentActivity: 'Still collecting sources.' })],
      evidence: makeEvidence({
        hasIncompleteToolCalls: true,
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('resume');
    expect(decision.checkpointTitle).toBe(PILOT_REVIEW_CHECKPOINT_TITLE);
    expect(decision.evaluation.evaluatorVersion).toContain('heuristic');
    expect(decision.evaluation.source).toBe('heuristic');
    expect(decision.evaluation.fallbackReason).toBe('response_unparseable');
    expect(decision.evaluation.approved).toBe(false);
    expect(decision.evaluation.controlAction).toBe('continue');
    expect(decision.evaluation.nextActions[0]).toContain('continue monitoring');
  });

  it('re-evaluates when the observed worker state changes even if timestamps still look reviewed', async () => {
    mockSendMessage
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'pilot-call-1',
              function: {
                name: 'pilot_report',
                arguments: JSON.stringify({
                  recommendedAction: 'finalize',
                  controlAction: 'accept',
                  completionScore: 5,
                  adherenceScore: 4,
                  evidenceScore: 5,
                  processScore: 4,
                  approved: true,
                  confidence: 'high',
                  summary: 'The run is complete and verified.',
                  rationale: 'All requested work is done and backed by verified evidence.',
                  strengths: ['Verified evidence captured.'],
                  gaps: [],
                  nextActions: [],
                  criterionEvaluations: [
                    {
                      criterion: 'Produce the requested deliverable.',
                      score: 5,
                      status: 'met',
                      rationale: 'The deliverable exists.',
                    },
                    {
                      criterion: 'Verify the result before finalizing.',
                      score: 4,
                      status: 'met',
                      rationale: 'The result is verified.',
                    },
                  ],
                }),
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'pilot-call-2',
              function: {
                name: 'pilot_report',
                arguments: JSON.stringify({
                  recommendedAction: 'blocked',
                  controlAction: 'block',
                  completionScore: 1,
                  adherenceScore: 2,
                  evidenceScore: 1,
                  processScore: 2,
                  approved: false,
                  confidence: 'medium',
                  summary: 'Background worker state was lost before completion could be confirmed.',
                  rationale: 'The run no longer has a valid worker completion state to approve.',
                  strengths: [],
                  gaps: ['Worker state was lost.'],
                  nextActions: [],
                  criterionEvaluations: [
                    {
                      criterion: 'Produce the requested deliverable.',
                      score: 1,
                      status: 'blocked',
                      rationale: 'Worker completion could not be confirmed.',
                    },
                    {
                      criterion: 'Verify the result before finalizing.',
                      score: 1,
                      status: 'blocked',
                      rationale: 'Verification state was lost with the worker snapshot.',
                    },
                  ],
                }),
              },
            }],
          },
        }],
      });

    const firstDecision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    const secondDecision = await evaluateAgentRunWithPilot({
      run: makeRun({
        checkpoints: [
          {
            id: 'cp-1',
            timestamp: 50,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot already reviewed this state.',
          },
        ],
        latestPilotEvaluation: firstDecision.evaluation,
      }),
      workers: [],
      evidence: makeEvidence({
        lastSubstantiveResult: '',
        resultPreviews: [],
        toolsUsed: [],
      }),
      candidateOutcome: {
        status: 'failed',
        summary: 'Background worker state was lost before completion could be confirmed.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(secondDecision.outcome.status).toBe('cancelled');
    expect(secondDecision.checkpointTitle).toBe('Pilot blocked finalization');
    expect(secondDecision.evaluation.stateSignature).not.toBe(firstDecision.evaluation.stateSignature);
  });

  it('parses structured pilot JSON returned as assistant content when a provider does not emit tool calls', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: `\`\`\`json
${JSON.stringify({
  recommendedAction: 'finalize',
  controlAction: 'accept',
  completionScore: 5,
  adherenceScore: 4,
  evidenceScore: 5,
  processScore: 4,
  approved: true,
  confidence: 'high',
  summary: 'The run is complete and verified.',
  rationale: 'All requested work is done and backed by verified evidence.',
  strengths: ['Verified evidence captured.'],
  gaps: [],
  nextActions: [],
  criterionEvaluations: [
    {
      criterion: 'Produce the requested deliverable.',
      score: 5,
      status: 'met',
      rationale: 'The deliverable exists.',
    },
    {
      criterion: 'Verify the result before finalizing.',
      score: 4,
      status: 'met',
      rationale: 'The result is verified.',
    },
  ],
}, null, 2)}
\`\`\``,
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses structured pilot JSON returned in assistant reasoning when content is empty', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          reasoning: JSON.stringify({
            recommendedAction: 'finalize',
            controlAction: 'accept',
            completionScore: 5,
            adherenceScore: 4,
            evidenceScore: 5,
            processScore: 4,
            approved: true,
            confidence: 'high',
            summary: 'The run is complete and verified.',
            rationale: 'All requested work is done and backed by verified evidence.',
            strengths: ['Verified evidence captured.'],
            gaps: [],
            nextActions: [],
            criterionEvaluations: [
              {
                criterion: 'Produce the requested deliverable.',
                score: 5,
                status: 'met',
                rationale: 'The deliverable exists.',
              },
              {
                criterion: 'Verify the result before finalizing.',
                score: 4,
                status: 'met',
                rationale: 'The result is verified.',
              },
            ],
          }),
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses structured pilot JSON returned on message.parsed', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          parsed: {
            recommendedAction: 'finalize',
            controlAction: 'accept',
            completionScore: 5,
            adherenceScore: 4,
            evidenceScore: 5,
            processScore: 4,
            approved: true,
            confidence: 'high',
            summary: 'The run is complete and verified.',
            rationale: 'All requested work is done and backed by verified evidence.',
            strengths: ['Verified evidence captured.'],
            gaps: [],
            nextActions: [],
            criterionEvaluations: [
              {
                criterion: 'Produce the requested deliverable.',
                score: 5,
                status: 'met',
                rationale: 'The deliverable exists.',
              },
              {
                criterion: 'Verify the result before finalizing.',
                score: 4,
                status: 'met',
                rationale: 'The result is verified.',
              },
            ],
          },
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses native OpenAI Responses pilot payloads before relying on normalized message output', async () => {
    mockSendMessage.mockResolvedValue({
      providerResponse: {
        provider: 'openai-responses',
        response: {
          id: 'resp_native_pilot_1',
          status: 'completed',
          output: makePilotPayload(),
        },
      },
      choices: [{
        message: {
          role: 'assistant',
          content: '',
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses native Gemini pilot payloads before relying on normalized message output', async () => {
    mockSendMessage.mockResolvedValue({
      providerResponse: {
        provider: 'gemini',
        response: {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify(makePilotPayload()),
              }],
            },
            finishReason: 'STOP',
          }],
        },
      },
      choices: [{
        message: {
          role: 'assistant',
          content: '',
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeGeminiProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses native Anthropic pilot payloads before relying on normalized message output', async () => {
    mockSendMessage.mockResolvedValue({
      providerResponse: {
        provider: 'anthropic',
        response: {
          content: [{
            type: 'text',
            text: JSON.stringify(makePilotPayload()),
          }],
          stop_reason: 'end_turn',
        },
      },
      choices: [{
        message: {
          role: 'assistant',
          content: '',
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeAnthropicProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses structured pilot JSON returned as content parts on compatible chat responses', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: JSON.stringify({
              recommendedAction: 'finalize',
              controlAction: 'accept',
              completionScore: 5,
              adherenceScore: 4,
              evidenceScore: 5,
              processScore: 4,
              approved: true,
              confidence: 'high',
              summary: 'The run is complete and verified.',
              rationale: 'All requested work is done and backed by verified evidence.',
              strengths: ['Verified evidence captured.'],
              gaps: [],
              nextActions: [],
              criterionEvaluations: [
                {
                  criterion: 'Produce the requested deliverable.',
                  score: 5,
                  status: 'met',
                  rationale: 'The deliverable exists.',
                },
                {
                  criterion: 'Verify the result before finalizing.',
                  score: 4,
                  status: 'met',
                  rationale: 'The result is verified.',
                },
              ],
            }),
          }],
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses structured pilot JSON from nested text.value wrappers', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: {
              value: JSON.stringify(makePilotPayload()),
            },
          }],
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses pilot tool blocks embedded directly in assistant content arrays', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Pilot assessment follows.' },
            {
              type: 'tool_use',
              name: 'pilot_report',
              input: {
                recommendedAction: 'finalize',
                controlAction: 'accept',
                completionScore: 5,
                adherenceScore: 4,
                evidenceScore: 5,
                processScore: 4,
                approved: true,
                confidence: 'high',
                summary: 'The run is complete and verified.',
                rationale: 'All requested work is done and backed by verified evidence.',
                strengths: ['Verified evidence captured.'],
                gaps: [],
                nextActions: [],
                criterionEvaluations: [
                  {
                    criterion: 'Produce the requested deliverable.',
                    score: 5,
                    status: 'met',
                    rationale: 'The deliverable exists.',
                  },
                  {
                    criterion: 'Verify the result before finalizing.',
                    score: 4,
                    status: 'met',
                    rationale: 'The result is verified.',
                  },
                ],
              },
            },
          ],
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses legacy function_call pilot payloads returned by compatible providers', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          function_call: {
            name: 'pilot_report',
            arguments: JSON.stringify({
              recommendedAction: 'finalize',
              controlAction: 'accept',
              completionScore: 5,
              adherenceScore: 4,
              evidenceScore: 5,
              processScore: 4,
              approved: true,
              confidence: 'high',
              summary: 'The run is complete and verified.',
              rationale: 'All requested work is done and backed by verified evidence.',
              strengths: ['Verified evidence captured.'],
              gaps: [],
              nextActions: [],
              criterionEvaluations: [
                {
                  criterion: 'Produce the requested deliverable.',
                  score: 5,
                  status: 'met',
                  rationale: 'The deliverable exists.',
                },
                {
                  criterion: 'Verify the result before finalizing.',
                  score: 4,
                  status: 'met',
                  rationale: 'The result is verified.',
                },
              ],
            }),
          },
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses structured pilot tool calls preserved only in Gemini providerReplay', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          providerReplay: {
            geminiParts: [{
              functionCall: {
                name: 'pilot_report',
                args: {
                  recommendedAction: 'finalize',
                  controlAction: 'accept',
                  completionScore: 5,
                  adherenceScore: 4,
                  evidenceScore: 5,
                  processScore: 4,
                  approved: true,
                  confidence: 'high',
                  summary: 'The run is complete and verified.',
                  rationale: 'All requested work is done and backed by verified evidence.',
                  strengths: ['Verified evidence captured.'],
                  gaps: [],
                  nextActions: [],
                  criterionEvaluations: [
                    {
                      criterion: 'Produce the requested deliverable.',
                      score: 5,
                      status: 'met',
                      rationale: 'The deliverable exists.',
                    },
                    {
                      criterion: 'Verify the result before finalizing.',
                      score: 4,
                      status: 'met',
                      rationale: 'The result is verified.',
                    },
                  ],
                },
              },
            }],
          },
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('parses structured pilot tool calls preserved only in Anthropic providerReplay', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          providerReplay: {
            anthropicBlocks: [{
              type: 'tool_use',
              id: 'toolu_1',
              name: 'pilot_report',
              input: {
                recommendedAction: 'finalize',
                controlAction: 'accept',
                completionScore: 5,
                adherenceScore: 4,
                evidenceScore: 5,
                processScore: 4,
                approved: true,
                confidence: 'high',
                summary: 'The run is complete and verified.',
                rationale: 'All requested work is done and backed by verified evidence.',
                strengths: ['Verified evidence captured.'],
                gaps: [],
                nextActions: [],
                criterionEvaluations: [
                  {
                    criterion: 'Produce the requested deliverable.',
                    score: 5,
                    status: 'met',
                    rationale: 'The deliverable exists.',
                  },
                  {
                    criterion: 'Verify the result before finalizing.',
                    score: 4,
                    status: 'met',
                    rationale: 'The result is verified.',
                  },
                ],
              },
            }],
          },
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeAnthropicProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('accepts machine-readable pilot JSON returned directly in assistant content arrays', async () => {
    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: JSON.stringify({
              recommendedAction: 'finalize',
              controlAction: 'accept',
              completionScore: 5,
              adherenceScore: 4,
              evidenceScore: 5,
              processScore: 4,
              approved: true,
              confidence: 'high',
              summary: 'The run is complete and verified.',
              rationale: 'All requested work is done and backed by verified evidence.',
              strengths: ['Verified evidence captured.'],
              gaps: [],
              nextActions: [],
              criterionEvaluations: [
                {
                  criterion: 'Produce the requested deliverable.',
                  score: 5,
                  status: 'met',
                  rationale: 'The deliverable exists.',
                },
                {
                  criterion: 'Verify the result before finalizing.',
                  score: 4,
                  status: 'met',
                  rationale: 'The result is verified.',
                },
              ],
            }),
          }],
        },
      }],
    });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('retries once when the first pilot evaluator reply is prose instead of a tool payload', async () => {
    mockSendMessage
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: 'The run is complete and verified.',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'pilot-call-retry',
              function: {
                name: 'pilot_report',
                arguments: JSON.stringify({
                  recommendedAction: 'finalize',
                  controlAction: 'accept',
                  completionScore: 5,
                  adherenceScore: 4,
                  evidenceScore: 5,
                  processScore: 4,
                  approved: true,
                  confidence: 'high',
                  summary: 'The run is complete and verified.',
                  rationale: 'All requested work is done and backed by verified evidence.',
                  strengths: ['Verified evidence captured.'],
                  gaps: [],
                  nextActions: [],
                  criterionEvaluations: [
                    {
                      criterion: 'Produce the requested deliverable.',
                      score: 5,
                      status: 'met',
                      rationale: 'The deliverable exists.',
                    },
                    {
                      criterion: 'Verify the result before finalizing.',
                      score: 4,
                      status: 'met',
                      rationale: 'The result is verified.',
                    },
                  ],
                }),
              },
            }],
          },
        }],
      });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    const retryMessages = mockSendMessage.mock.calls[1]?.[0] as Array<{ content?: string }>;
    const retryPrompt = retryMessages[retryMessages.length - 1]?.content;
    expect(retryPrompt).toContain('not machine-readable');
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('sanitizes OpenAI retry history down to the response ID when the first pilot reply is not machine-readable', async () => {
    mockSendMessage
      .mockResolvedValueOnce({
        id: 'resp_retry_1',
        choices: [{
          message: {
            role: 'assistant',
            content: 'The run is complete and verified.',
            providerReplay: {
              openaiResponseId: 'resp_retry_1',
              openaiResponseOutput: [{
                id: 'fc_retry_1',
                type: 'function_call',
                call_id: 'call_retry_1',
                name: 'read_file',
                arguments: JSON.stringify({ path: 'report.json' }),
              }],
            },
            tool_calls: [{
              id: 'call_retry_1',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ path: 'report.json' }),
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              recommendedAction: 'finalize',
              controlAction: 'accept',
              completionScore: 5,
              adherenceScore: 4,
              evidenceScore: 5,
              processScore: 4,
              approved: true,
              confidence: 'high',
              summary: 'The run is complete and verified.',
              rationale: 'All requested work is done and backed by verified evidence.',
              strengths: ['Verified evidence captured.'],
              gaps: [],
              nextActions: [],
              criterionEvaluations: [
                {
                  criterion: 'Produce the requested deliverable.',
                  score: 5,
                  status: 'met',
                  rationale: 'The deliverable exists.',
                },
                {
                  criterion: 'Verify the result before finalizing.',
                  score: 4,
                  status: 'met',
                  rationale: 'The result is verified.',
                },
              ],
            }),
          },
        }],
      });

    const decision = await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker()],
      evidence: makeEvidence(),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    const retryMessages = mockSendMessage.mock.calls[1]?.[0] as Array<Record<string, any>>;
    expect(retryMessages[2]).toEqual(expect.objectContaining({
      role: 'assistant',
      content: 'The run is complete and verified.',
      providerReplay: { openaiResponseId: 'resp_retry_1' },
    }));
    expect(retryMessages[2]?.tool_calls).toBeUndefined();
    expect(decision.action).toBe('finalize');
    expect(decision.evaluation.approved).toBe(true);
    expect(decision.evaluation.controlAction).toBe('accept');
  });

  it('includes full assistant and result evidence in the pilot prompt when the model budget allows it', async () => {
    const longDraft = `draft-start ${'x'.repeat(2_500)} draft-end`;
    const longResult = `result-start ${'y'.repeat(3_500)} result-end`;
    const longToolOutput = `tool-output-start ${'z'.repeat(2_200)} tool-output-end`;

    mockSendMessage.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'pilot-call-large-evidence',
            function: {
              name: 'pilot_report',
              arguments: JSON.stringify({
                recommendedAction: 'finalize',
                controlAction: 'accept',
                completionScore: 5,
                adherenceScore: 4,
                evidenceScore: 5,
                processScore: 4,
                approved: true,
                confidence: 'high',
                summary: 'The run is complete and verified.',
                rationale: 'All requested work is done and backed by verified evidence.',
                strengths: ['Verified evidence captured.'],
                gaps: [],
                nextActions: [],
                criterionEvaluations: [
                  {
                    criterion: 'Produce the requested deliverable.',
                    score: 5,
                    status: 'met',
                    rationale: 'The deliverable exists.',
                  },
                  {
                    criterion: 'Verify the result before finalizing.',
                    score: 4,
                    status: 'met',
                    rationale: 'The result is verified.',
                  },
                ],
              }),
            },
          }],
        },
      }],
    });

    await evaluateAgentRunWithPilot({
      run: makeRun(),
      workers: [makeWorker({ output: longResult })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user', role: 'user', content: 'Fix the workflow and verify it.', timestamp: 10 }),
          makeMessage({ id: 'msg-assistant', role: 'assistant', content: longDraft, timestamp: 20 }),
          makeMessage({ id: 'msg-tool', role: 'tool', content: longToolOutput, toolCallId: 'tc-long', timestamp: 30 }),
        ],
        lastNonEmptyAssistantContent: longDraft,
        lastSubstantiveResult: longResult,
        resultPreviews: [{ sourceName: 'worker', preview: 'Verified implementation details.' }],
      }),
      candidateOutcome: {
        status: 'completed',
        summary: 'Supervisor reached a completion candidate.',
      },
      providerContext: makeProviderContext(),
    });

    const requestMessages = mockSendMessage.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const prompt = requestMessages[1]?.content;

    expect(prompt).toContain('draft-end');
    expect(prompt).toContain('result-end');
    expect(prompt).toContain('tool-output-end');
    expect(prompt).toContain('Conversation memory (shared only within this conversation):');
    expect(prompt).toContain('Conversation memory: pending validation notes.');
    expect(prompt).toContain('Global memory (durable across conversations):');
    expect(prompt).toContain('Global memory: prefer production-ready verification.');
  });

  it('treats draft-only churn as a new reviewed state so the pilot reassesses the continuation', () => {
    const firstDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun(),
      workers: [makeWorker({ status: 'error', updatedAt: 40, output: 'pytest failed with a schema mismatch.' })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-1', role: 'user', content: 'Recover the workflow.', timestamp: 10 }),
          makeMessage({ id: 'msg-assistant-1', role: 'assistant', content: 'Initial recovery draft.', timestamp: 20 }),
        ],
        lastNonEmptyAssistantContent: 'Initial recovery draft.',
        lastSubstantiveResult: 'pytest failed with a schema mismatch.',
        resultPreviews: [{ sourceName: 'worker', preview: 'pytest failed with a schema mismatch.' }],
        toolsUsed: ['sessions_status'],
      }),
    });

    const secondDecision = decideAgentRunPilotAfterBackgroundWorkers({
      run: makeRun({
        updatedAt: 500,
        checkpoints: [
          {
            id: 'cp-1',
            timestamp: 60,
            kind: 'run',
            title: PILOT_REVIEW_CHECKPOINT_TITLE,
            detail: 'Pilot already reviewed this state.',
          },
        ],
        latestPilotEvaluation: firstDecision.evaluation,
      }),
      workers: [makeWorker({ status: 'error', updatedAt: 400, output: 'pytest failed with a schema mismatch.' })],
      evidence: makeEvidence({
        transcriptMessages: [
          makeMessage({ id: 'msg-user-2', role: 'user', content: 'Recover the workflow.', timestamp: 310 }),
          makeMessage({ id: 'msg-assistant-2', role: 'assistant', content: 'Rewritten recovery draft with no new evidence.', timestamp: 320 }),
        ],
        lastNonEmptyAssistantContent: 'Rewritten recovery draft with no new evidence.',
        lastSubstantiveResult: 'pytest failed with a schema mismatch.',
        resultPreviews: [{ sourceName: 'worker', preview: 'pytest failed with a schema mismatch.' }],
        toolsUsed: ['sessions_status'],
      }),
    });

    expect(firstDecision.action).toBe('resume');
    expect(secondDecision.action).toBe('resume');
    expect(secondDecision.evaluation.stateSignature).not.toBe(firstDecision.evaluation.stateSignature);
  });
});