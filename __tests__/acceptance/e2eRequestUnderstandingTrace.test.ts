import { buildGraphSnapshotTrace } from '../../src/acceptance/e2eAgent/e2eTraceGraphSnapshots';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';
import {
  projectRequestUnderstanding,
  summarizeRequestUnderstanding,
} from '../../src/services/agents/requestUnderstandingProjection';

const { projectGraphSnapshot } = require('../../scripts/e2eReport/publicTraceGraph');

describe('request understanding E2E trace', () => {
  it('exports only closed enums and counts, never request text', () => {
    const requestUnderstanding = summarizeRequestUnderstanding(
      projectRequestUnderstanding({
        requestFrame: buildGraphEntryRequestFrame({
          text: 'PRIVATE-REQUEST-TEXT-NEVER-EXPORT',
          attachmentCount: 0,
          mode: 'agentic',
          continuation: 'resume',
        }),
      }),
    );
    const trace = buildGraphSnapshotTrace(
      createInitialAgentRunControlGraphState({ requestUnderstanding, updatedAt: 1 }),
    );

    expect(trace.requestUnderstanding).toMatchObject({
      version: 3,
      integrity: 'valid',
      routing: {
        status: 'known',
        mode: 'agentic',
        continuation: 'resume',
        decisionAction: 'act',
      },
      registeredRequiredInformation: { status: 'known', count: 0, unresolvedCount: 0 },
      effectAuthorization: { status: 'unknown' },
    });
    expect(JSON.stringify(trace)).not.toContain('PRIVATE-REQUEST-TEXT-NEVER-EXPORT');

    const projected = projectGraphSnapshot({
      ...trace,
      requestUnderstanding: {
        ...trace.requestUnderstanding,
        privateText: 'PRIVATE-ADDED-FIELD-NEVER-EXPORT',
      },
    });
    expect(projected.requestUnderstanding).toEqual(trace.requestUnderstanding);
    expect(JSON.stringify(projected)).not.toContain('PRIVATE-ADDED-FIELD-NEVER-EXPORT');
  });

  it('rejects an invalid request-understanding enum instead of publishing it', () => {
    const state = createInitialAgentRunControlGraphState();
    const trace = buildGraphSnapshotTrace(state);
    expect(
      projectGraphSnapshot({
        ...trace,
        requestUnderstanding: {
          version: 3,
          integrity: 'valid',
          routing: { status: 'invented' },
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
