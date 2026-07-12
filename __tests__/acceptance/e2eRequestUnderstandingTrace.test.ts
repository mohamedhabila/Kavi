import { buildGraphSnapshotTrace } from '../../src/acceptance/e2eAgent/e2eTraceGraphSnapshots';
import { createGoal } from '../../src/engine/goals/types';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';
import {
  projectRequestUnderstanding,
  summarizeRequestUnderstanding,
} from '../../src/services/agents/requestUnderstandingProjection';

const { projectGraphSnapshot } = require('../../scripts/e2eReport/publicTraceGraph');

describe('request understanding E2E trace', () => {
  it('exports only closed enums and counts, never objective or criterion text', () => {
    const goal = createGoal({
      id: 'PRIVATE-GOAL-ID-NEVER-EXPORT',
      title: 'PRIVATE-GOAL-TITLE-NEVER-EXPORT',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.prefix:PRIVATE-CRITERION-NEVER-EXPORT'],
      userConstraints: [
        {
          text: 'PRIVATE-CONSTRAINT-TEXT-NEVER-EXPORT',
          sourceMessageId: 'PRIVATE-CONSTRAINT-SOURCE-NEVER-EXPORT',
        },
      ],
      now: 1,
    });
    const requestUnderstanding = summarizeRequestUnderstanding(
      projectRequestUnderstanding({
        requestFrame: buildGraphEntryRequestFrame({
          text: 'PRIVATE-REQUEST-TEXT-NEVER-EXPORT',
          attachmentCount: 0,
          mode: 'agentic',
          continuation: 'resume',
        }),
        goals: [goal],
      }),
    );
    const trace = buildGraphSnapshotTrace(
      createInitialAgentRunControlGraphState({
        goals: [goal],
        requestUnderstanding,
        updatedAt: 1,
      }),
    );

    expect(trace.requestUnderstanding).toMatchObject({
      version: 2,
      integrity: 'valid',
      routing: {
        status: 'known',
        mode: 'agentic',
        continuation: 'resume',
        decisionAction: 'act',
      },
      declaredObjectives: { status: 'known', count: 1, omittedCount: 0 },
      structuredSuccessConditions: { status: 'known', count: 1, omittedCount: 0 },
      userConstraints: { status: 'known', count: 1, omittedCount: 0 },
      effectAuthorization: { status: 'unknown' },
    });
    const serialized = JSON.stringify(trace.requestUnderstanding);
    expect(serialized).not.toContain('PRIVATE-GOAL-ID-NEVER-EXPORT');
    expect(serialized).not.toContain('PRIVATE-GOAL-TITLE-NEVER-EXPORT');
    expect(serialized).not.toContain('PRIVATE-CRITERION-NEVER-EXPORT');
    expect(serialized).not.toContain('PRIVATE-REQUEST-TEXT-NEVER-EXPORT');
    expect(serialized).not.toContain('PRIVATE-CONSTRAINT-TEXT-NEVER-EXPORT');
    expect(serialized).not.toContain('PRIVATE-CONSTRAINT-SOURCE-NEVER-EXPORT');
    const fullTrace = JSON.stringify(trace);
    expect(fullTrace).not.toContain('PRIVATE-CONSTRAINT-TEXT-NEVER-EXPORT');
    expect(fullTrace).not.toContain('PRIVATE-CONSTRAINT-SOURCE-NEVER-EXPORT');

    const projected = projectGraphSnapshot({
      ...trace,
      requestUnderstanding: {
        ...trace.requestUnderstanding,
        userConstraints: {
          ...trace.requestUnderstanding?.userConstraints,
          text: 'PRIVATE-ADDED-CONSTRAINT-TEXT-NEVER-EXPORT',
          sourceMessageId: 'PRIVATE-ADDED-CONSTRAINT-SOURCE-NEVER-EXPORT',
        },
        privateText: 'PRIVATE-ADDED-FIELD-NEVER-EXPORT',
      },
    });
    expect(projected.requestUnderstanding).toEqual(trace.requestUnderstanding);
    expect(JSON.stringify(projected)).not.toContain('PRIVATE-ADDED-FIELD-NEVER-EXPORT');
    expect(JSON.stringify(projected)).not.toContain('PRIVATE-ADDED-CONSTRAINT');
  });

  it('rejects an invalid request-understanding enum instead of publishing it', () => {
    const state = createInitialAgentRunControlGraphState();
    const trace = buildGraphSnapshotTrace(state);
    expect(
      projectGraphSnapshot({
        ...trace,
        requestUnderstanding: {
          version: 2,
          integrity: 'valid',
          routing: { status: 'invented' },
          declaredObjectives: { status: 'unknown', count: 0, omittedCount: 0 },
          structuredSuccessConditions: { status: 'unknown', count: 0, omittedCount: 0 },
          executionRequirements: { status: 'unknown', count: 0, omittedCount: 0 },
          userConstraints: { status: 'unknown', count: 0, omittedCount: 0 },
          registeredRequiredInformation: {
            status: 'unknown',
            count: 0,
            omittedCount: 0,
            unresolvedCount: 0,
          },
          effectAuthorization: { status: 'unknown' },
        },
      }),
    ).toBeNull();
  });
});
