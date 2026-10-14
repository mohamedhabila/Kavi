import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import {
  buildRequestClarificationToolResult,
  type RequestClarification,
} from '../../src/services/agents/requestClarification';
import { buildBaseParams, createToolMessage } from '../helpers/toolExecutionOutcomeHarness';

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
            {
              key: 'recipient',
              requiredFor: 'execution',
              semanticRole: 'recipient',
              resolution: 'unresolved',
            },
            {
              key: 'message_body',
              requiredFor: 'execution',
              semanticRole: 'content',
              resolution: 'unresolved',
            },
          ],
        },
        content: clarification.question,
        sessionEndReason: 'request_clarification',
      }),
    );
    // The pending user input is the one record of what is missing; no routing copy is kept.
    expect(
      params.applyGraphEvents.mock.calls.flatMap(([events]: [Array<{ type: string }>]) =>
        events.map((event) => event.type),
      ),
    ).toEqual(['TOOL_RESULT_RECORDED']);
    expect(params.onStateChange).not.toHaveBeenCalledWith('thinking');
  });
});
