import {
  containsRawProviderToolCallMarkup,
  stripRawProviderToolCallMarkupForDisplay,
} from '../../src/utils/assistantTextSanitizer';

// Traced on the GLM 5.3 Flash suite (direct-spabench-cross-app-device-actions), taken
// verbatim from the run. A forced final-text turn answered with GLM's own tool-call
// format instead of prose. None of the recognized dialects matched it, so the turn was
// not held for a retry, nothing was stripped, and the user was shown the markup as the
// run's answer.

const TRACED =
  '<tool_call>clipboard<arg_key>action</arg_key><arg_value>read</arg_value></tool_call>';

describe("a tool call written in GLM's arg-pair format is recognized", () => {
  it('detects the traced reply, so the run holds instead of delivering it', () => {
    expect(containsRawProviderToolCallMarkup(TRACED)).toBe(true);
  });

  it('detects the multi-line, multi-argument form the template produces', () => {
    const multiLine = [
      '<tool_call>notification_schedule',
      '<arg_key>title</arg_key>',
      '<arg_value>Stretch</arg_value>',
      '<arg_key>delaySeconds</arg_key>',
      '<arg_value>30</arg_value>',
      '</tool_call>',
    ].join('\n');

    expect(containsRawProviderToolCallMarkup(multiLine)).toBe(true);
  });

  it('detects a call that takes no arguments', () => {
    expect(containsRawProviderToolCallMarkup('<tool_call>clipboard_read\n</tool_call>')).toBe(true);
  });

  it('strips it from what the user sees and keeps the prose around it', () => {
    const sanitized = stripRawProviderToolCallMarkupForDisplay(`Checking the clipboard.\n${TRACED}`);

    expect(sanitized).toBe('Checking the clipboard.');
  });
});

describe('text that only mentions these tags is left alone', () => {
  it('needs a closed call, not just the words', () => {
    const prose = 'GLM wraps calls in <tool_call> tags with <arg_key> and <arg_value> pairs.';

    expect(containsRawProviderToolCallMarkup(prose)).toBe(false);
    expect(stripRawProviderToolCallMarkupForDisplay(prose)).toBe(prose);
  });

  it('does not fire on an unterminated call', () => {
    expect(
      containsRawProviderToolCallMarkup('<tool_call>clipboard<arg_key>action</arg_key>'),
    ).toBe(false);
  });

  it('does not fire on a sentence placed inside the tags', () => {
    expect(
      containsRawProviderToolCallMarkup('<tool_call>read the clipboard first</tool_call>'),
    ).toBe(false);
  });
});
