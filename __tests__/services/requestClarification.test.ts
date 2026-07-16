import {
  buildRequestClarificationToolResult,
  isRequestInformationKey,
  parseRequestClarificationArgs,
  parseRequestClarificationToolResult,
} from '../../src/services/agents/requestClarification';
import { executeRequestClarification } from '../../src/engine/tools/toolRequestClarificationExecution';

describe('request clarification contract', () => {
  it('accepts language-neutral semantic fields with a multilingual user-facing question', () => {
    const parsed = parseRequestClarificationArgs({
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
      question: 'من هو المستلم، وما نص الرسالة التي تريد تجهيزها؟',
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        fields: [
          { key: 'recipient', requiredFor: 'execution', semanticRole: 'recipient' },
          { key: 'message_body', requiredFor: 'execution', semanticRole: 'content' },
        ],
        question: 'من هو المستلم، وما نص الرسالة التي تريد تجهيزها؟',
      },
    });
    if (!parsed.ok) throw new Error('Expected valid clarification');

    const result = buildRequestClarificationToolResult(parsed.value);
    expect(parseRequestClarificationToolResult(JSON.stringify(result))).toEqual(result);
    expect(result.requiredInformation).toEqual([
      {
        key: 'recipient',
        authority: 'user',
        requiredFor: 'execution',
        resolution: 'unresolved',
        semanticRole: 'recipient',
      },
      {
        key: 'message_body',
        authority: 'user',
        requiredFor: 'execution',
        resolution: 'unresolved',
        semanticRole: 'content',
      },
    ]);
  });

  it.each([
    {
      name: 'unknown top-level field',
      args: {
        missing_information: [
          {
            key: 'recipient',
            required_for: 'execution',
            semantic_role: 'recipient',
          },
        ],
        question: 'Who?',
        extra: true,
      },
      error: 'request_clarification_arguments_invalid',
    },
    {
      name: 'invalid semantic key',
      args: {
        missing_information: [
          {
            key: 'Recipient Name',
            required_for: 'execution',
            semantic_role: 'recipient',
          },
        ],
        question: 'Who?',
      },
      error: 'request_clarification_field_invalid',
    },
    {
      name: 'duplicate semantic key',
      args: {
        missing_information: [
          {
            key: 'recipient',
            required_for: 'execution',
            semantic_role: 'recipient',
          },
          {
            key: 'recipient',
            required_for: 'understanding',
            semantic_role: 'recipient',
          },
        ],
        question: 'Who?',
      },
      error: 'request_clarification_field_duplicate',
    },
    {
      name: 'unknown semantic role',
      args: {
        missing_information: [
          {
            key: 'recipient',
            required_for: 'execution',
            semantic_role: 'person',
          },
        ],
        question: 'Who?',
      },
      error: 'request_clarification_field_invalid',
    },
    {
      name: 'empty question',
      args: {
        missing_information: [
          {
            key: 'recipient',
            required_for: 'execution',
            semantic_role: 'recipient',
          },
        ],
        question: '   ',
      },
      error: 'request_clarification_arguments_invalid',
    },
  ])('rejects $name', ({ args, error }) => {
    expect(parseRequestClarificationArgs(args)).toEqual({ ok: false, error });
  });

  it('executes the bounded contract and fails closed on invalid input', () => {
    const completed = executeRequestClarification({
      missing_information: [
        {
          key: 'account.selection',
          required_for: 'understanding',
          semantic_role: 'selection',
        },
      ],
      question: 'Which account should I use?',
    });
    expect(completed.status).toBe('completed');
    expect(parseRequestClarificationToolResult(completed.content)).toMatchObject({
      status: 'clarification_requested',
      requiredInformation: [
        {
          key: 'account.selection',
          authority: 'user',
          requiredFor: 'understanding',
          resolution: 'unresolved',
          semanticRole: 'selection',
        },
      ],
    });

    const failed = executeRequestClarification({
      missing_information: [],
      question: 'Which account?',
    });
    expect(failed.status).toBe('failed');
    expect(JSON.parse(failed.content)).toMatchObject({
      status: 'error',
      code: 'request_clarification_arguments_invalid',
    });
  });

  it('keeps semantic keys structural rather than language-dependent prose', () => {
    expect(isRequestInformationKey('new_start_time')).toBe(true);
    expect(isRequestInformationKey('calendar.event.title')).toBe(true);
    expect(isRequestInformationKey('موعد')).toBe(false);
    expect(isRequestInformationKey('what time?')).toBe(false);
  });
});
