import { buildToolMessageOutcome } from '../../src/engine/toolExecution/toolMessageOutcome';

describe('tool message outcome', () => {
  it.each([
    'Error: opaque result data',
    'فشل مكتوب داخل المحتوى فقط',
    'échec · Fehler · 失败',
    '{"status":"error","error":"opaque payload"}',
  ])('does not infer failure from result prose: %s', (content) => {
    expect(
      buildToolMessageOutcome({
        toolCallId: 'tool-1',
        toolMessage: { content, isError: false },
      }),
    ).toEqual({ version: 1, toolCallId: 'tool-1', status: 'completed', content });
  });

  it.each(['Completed successfully', 'تم التنفيذ بنجاح', '完了しました', '{"status":"ok"}'])(
    'does not let success-like result prose mask failure: %s',
    (content) => {
      expect(
        buildToolMessageOutcome({
          toolCallId: 'tool-2',
          toolMessage: { content, isError: true },
        }),
      ).toEqual({ version: 1, toolCallId: 'tool-2', status: 'failed', content });
    },
  );

  it('rejects an empty tool-call identity', () => {
    expect(() =>
      buildToolMessageOutcome({
        toolCallId: '   ',
        toolMessage: { content: 'opaque' },
      }),
    ).toThrow('tool_message_outcome_tool_call_id_required');
  });
});
