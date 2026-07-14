import {
  buildGraphEntryRequestFrame,
  normalizeRequestText,
} from '../../src/engine/graph/requestEntrySignals';

describe('graph entry request frame', () => {
  it.each([
    {
      text: '',
      attachmentCount: 0,
      kind: 'empty',
      action: 'clarify',
      reason: 'missing_input',
    },
    {
      text: ' ... ',
      attachmentCount: 0,
      kind: 'text',
      action: 'act',
      reason: 'actionable_input',
    },
    {
      text: '',
      attachmentCount: 1,
      kind: 'attachments',
      action: 'act',
      reason: 'actionable_input',
    },
    {
      text: 'What is in this image?',
      attachmentCount: 2,
      kind: 'text_and_attachments',
      action: 'act',
      reason: 'actionable_input',
    },
    {
      text: 'CHECKNO42',
      attachmentCount: 0,
      kind: 'text',
      action: 'act',
      reason: 'actionable_input',
    },
  ] as const)(
    'classifies $kind input with the closed structural decision',
    ({ text, attachmentCount, kind, action, reason }) => {
      expect(
        buildGraphEntryRequestFrame({
          text,
          attachmentCount,
          mode: 'agentic',
          continuation: 'new',
        }),
      ).toMatchObject({
        version: 2,
        mode: 'agentic',
        input: { kind, attachmentCount },
        continuation: 'new',
        requiredInformation: [],
        decision: { action, reason },
      });
    },
  );

  it('preserves code-owned continuation and mode without inferring semantics', () => {
    expect(
      buildGraphEntryRequestFrame({
        text: 'continue',
        attachmentCount: 0,
        mode: 'chitchat',
        continuation: 'resume_waiting_async',
      }),
    ).toMatchObject({ mode: 'chitchat', continuation: 'resume_waiting_async' });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid attachment counts (%s)',
    (attachmentCount) => {
      expect(() =>
        buildGraphEntryRequestFrame({
          text: 'hello',
          attachmentCount,
          mode: 'chitchat',
          continuation: 'new',
        }),
      ).toThrow('request_frame_attachment_count_invalid');
    },
  );

  it.each(['...', '؟،', '…。', '🫶🏽', '∑→∞', '\u0301', '\u200d'])(
    'routes nonempty symbol or mixed-script input without guessing semantics: %s',
    (text) => {
      expect(
        buildGraphEntryRequestFrame({
          text,
          attachmentCount: 0,
          mode: 'chitchat',
          continuation: 'new',
        }),
      ).toMatchObject({
        input: { kind: 'text' },
        decision: { action: 'act', reason: 'actionable_input' },
      });
    },
  );

  it('normalizes Unicode whitespace without changing literal-token requests', () => {
    expect(normalizeRequestText('  CHECKNO42\n')).toBe('CHECKNO42');
    expect(normalizeRequestText('\u2003\u3000\n')).toBe('');
  });
});
