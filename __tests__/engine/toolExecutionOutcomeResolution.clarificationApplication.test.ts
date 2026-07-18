import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import {
  buildRequestClarificationToolResult,
  type RequestClarification,
} from '../../src/services/agents/requestClarification';
import {
  projectRequestUnderstanding,
  summarizeRequestUnderstanding,
} from '../../src/services/agents/requestUnderstandingProjection';
import {
  buildBaseParams,
  createToolMessage,
} from '../helpers/toolExecutionOutcomeHarness';

describe('tool execution clarification outcome resolution', () => {
  it('records structured missing information and waits for the user with the registered question', async () => {
    const params = buildBaseParams();
    const clarification: RequestClarification = {
      fields: [
        { key: 'recipient', requiredFor: 'execution', semanticRole: 'recipient' },
        { key: 'message_body', requiredFor: 'execution', semanticRole: 'content' },
      ],
      question: 'Who is the recipient, and what should the message say?',
    };
    const entryFrame = buildGraphEntryRequestFrame({
      text: 'Draft a message for me.',
      attachmentCount: 0,
      mode: 'agentic',
      continuation: 'new',
    });
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [],
      requestUnderstanding: summarizeRequestUnderstanding(
        projectRequestUnderstanding({ requestFrame: entryFrame, goals: [] }),
      ),
    });
    params.executableToolCalls = [
      {
        name: 'request_clarification',
        arguments: JSON.stringify({
          missing_information: [
            {
              key: 'recipient',
              required_for: 'execution',
              semantic_role: 'recipient',
            },
            {
              key: 'message_body',
              required_for: 'execution',
              semantic_role: 'content',
            },
          ],
          question: clarification.question,
        }),
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-clarify',
        toolMessage: createToolMessage({
          id: 'tc-clarify',
          name: 'request_clarification',
          content: JSON.stringify(buildRequestClarificationToolResult(clarification)),
        }),
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result.status).toBe('waiting');
    expect(params.publishWorkflowToolResultProgress).not.toHaveBeenCalled();
    expect(params.recordPostToolFinalTextDirective).not.toHaveBeenCalled();
    expect(params.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
    expect(params.finishWaitingForUserInput).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'USER_INPUT_REQUIRED',
          requestedAfterUserMessageId: 'user-test',
          requiredInformation: [
            { key: 'recipient', requiredFor: 'execution' },
            { key: 'message_body', requiredFor: 'execution' },
          ],
        },
        content: clarification.question,
        sessionEndReason: 'request_clarification',
      }),
    );
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'REQUEST_UNDERSTANDING_PROJECTED',
        projection: expect.objectContaining({
          routing: expect.objectContaining({
            status: 'known',
            decisionAction: 'clarify',
            decisionReason: 'required_information_missing',
          }),
          registeredRequiredInformation: expect.objectContaining({
            status: 'known',
            count: 2,
            unresolvedCount: 2,
          }),
        }),
      }),
    ]);
    expect(params.onStateChange).not.toHaveBeenCalledWith('thinking');
  });
});
