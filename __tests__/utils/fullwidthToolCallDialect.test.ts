import {
  containsRawProviderToolCallMarkup,
  stripRawProviderToolCallMarkupForDisplay,
} from '../../src/utils/assistantTextSanitizer';

// Traced live on an Android emulator, taken verbatim from the run it broke. The model
// closed its work by emitting a tool-call block built from U+FF5C FULLWIDTH VERTICAL LINE
// instead of `|`. The pattern matched only the ASCII pipe, so the block was neither
// stripped nor recognized: the markup rendered in chat, and the turn looked like prose
// carrying no tool call. Detection is what holds finalization and retries, so the run
// finalized instead — two goal completions never executed and the task's third step was
// silently abandoned with only one of its two artifacts written.

const FW = '｜';
const TRACED = [
  `<${FW}DSML${FW}tool_calls>`,
  `<${FW}DSML${FW}invoke name="update_goals">`,
  `<${FW}DSML${FW}parameter name="action" string="true">complete</${FW}DSML${FW}parameter>`,
  `<${FW}DSML${FW}parameter name="id" string="true">tidal-feasibility</${FW}DSML${FW}parameter>`,
  `</${FW}DSML${FW}invoke>`,
  `</${FW}DSML${FW}tool_calls>`,
].join('\n');

describe('a tool call written with fullwidth delimiters is recognized', () => {
  it('detects the traced block, so the run holds instead of finalizing', () => {
    expect(containsRawProviderToolCallMarkup(TRACED)).toBe(true);
  });

  it('strips it from what the user sees', () => {
    const sanitized = stripRawProviderToolCallMarkupForDisplay(`Closing out.\n${TRACED}`);

    expect(sanitized).not.toContain('tool_calls');
    expect(sanitized).not.toContain(FW);
    expect(sanitized).toContain('Closing out.');
  });

  it('still handles the ASCII dialect it always did', () => {
    const ascii = TRACED.split(FW).join('|');

    expect(containsRawProviderToolCallMarkup(ascii)).toBe(true);
    expect(stripRawProviderToolCallMarkupForDisplay(ascii)).not.toContain('tool_calls');
  });

  it('accepts a namespace other than the one observed', () => {
    const other = TRACED.split('DSML').join('NS');
    expect(containsRawProviderToolCallMarkup(other)).toBe(true);
  });
});

describe('prose about these tags is still left alone', () => {
  it('needs a closed invocation, not just the words', () => {
    const prose = `The model sometimes emits <${FW}DSML${FW}tool_calls> markup as text.`;

    expect(containsRawProviderToolCallMarkup(prose)).toBe(false);
    expect(stripRawProviderToolCallMarkupForDisplay(prose)).toContain('tool_calls');
  });

  it('does not fire on an unterminated block', () => {
    const partial = `<${FW}DSML${FW}tool_calls>\n<${FW}DSML${FW}invoke name="update_goals">`;
    expect(containsRawProviderToolCallMarkup(partial)).toBe(false);
  });
});
