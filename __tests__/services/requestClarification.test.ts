import {
  buildRequestClarificationToolResult,
  isRequestInformationKey,
  parseRequestClarificationArgs,
  parseRequestClarificationToolResult,
} from '../../src/services/agents/requestClarification';
import { REQUEST_CLARIFICATION_TOOL } from '../../src/engine/tools/requestClarificationDefinition';
import { executeRequestClarification } from '../../src/engine/tools/toolRequestClarificationExecution';

describe('request clarification contract', () => {
  it('treats directly usable memory as resolved input', () => {
    expect(REQUEST_CLARIFICATION_TOOL.description).toContain(
      'A retrieved memory fact labeled policy=use already resolves the parameter',
    );
  });

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
      detail:
        'request_clarification takes only missing_information and question (it also has extra).',
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
      detail:
        'missing_information[0].key must be a lower-case semantic key such as recipient or date_time (got "Recipient Name").',
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
      detail:
        'missing_information has the key "recipient" more than once; give each field its own key.',
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
      detail:
        'missing_information[0].semantic_role must be one of authorization, constraint, content, identifier, location, other, preference, quantity, recipient, selection, time, title (got "person").',
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
      detail: 'question must be one non-empty question of at most 1200 characters.',
    },
    {
      name: 'no fields',
      args: { missing_information: [], question: 'Who?' },
      error: 'request_clarification_arguments_invalid',
      detail: 'missing_information must list 1 to 12 fields.',
    },
    {
      name: 'an extra property on a field',
      args: {
        missing_information: [
          { key: 'recipient', required_for: 'execution', semantic_role: 'recipient', why: 'x' },
        ],
        question: 'Who?',
      },
      error: 'request_clarification_field_invalid',
      detail:
        'missing_information[0] takes only key, required_for and semantic_role (it also has why).',
    },
  ])('rejects $name, saying what to correct', ({ args, error, detail }) => {
    expect(parseRequestClarificationArgs(args)).toEqual({ ok: false, error, detail });
  });

  // GLM put a semantic role in required_for and was told only "Provide one question and one
  // to twelve unique semantic missing_information fields": it renamed the keys three times,
  // never touched required_for, and the run was stopped as a loop (pwglm2,
  // pw-mail-checkin-to-calendar).
  it('names the field and the values it takes when a field is wrong', () => {
    const failed = executeRequestClarification({
      missing_information: [
        { key: 'check-in-date', required_for: 'execution', semantic_role: 'time' },
        { key: 'hotel-name', required_for: 'content', semantic_role: 'content' },
      ],
      question: 'Which Porto hotel is it, and what day do you check in?',
    });

    expect(failed.status).toBe('failed');
    expect(JSON.parse(failed.content)).toEqual({
      status: 'error',
      code: 'request_clarification_field_invalid',
      error:
        'missing_information[1].required_for must be "understanding" or "execution" (got "content").',
    });
  });

  it('bounds a long wrong value it quotes back', () => {
    const parsed = parseRequestClarificationArgs({
      missing_information: [
        { key: 'recipient', required_for: 'x'.repeat(500), semantic_role: 'recipient' },
      ],
      question: 'Who?',
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail.length).toBeLessThan(200);
    expect(parsed.detail).toContain('…');
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
