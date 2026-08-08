import {
  containsRawProviderToolCallMarkup,
  stripRawProviderToolCallMarkupForDisplay,
} from '../../src/utils/assistantTextSanitizer';

// Traced live on an Android emulator. A run ended by rendering its own tool call as the
// reply: `<|DSML|tool_calls>` wrapping an `update_goals` invocation, shown to the user as
// the final answer. The detector spelled one vendor's tags literally, so this dialect was
// invisible to it — which defeated both gates at once. `noToolTurnResolution` never held
// the turn to make the model reissue the call through the tool channel, and the display
// strip never fired, because that strip only runs on an intermediate segment that already
// carries a structured tool call.

const VENDOR_FUNCTION_DIALECT =
  '<tool_call><function=update_goals>{"id":"research-brief"}</function></tool_call>';

const SPECIAL_TOKEN_DIALECT = [
  '<|DSML|tool_calls>',
  '<|DSML|invoke name="update_goals">',
  '<|DSML|parameter name="id" string="true">research-brief</|DSML|parameter>',
  '<|DSML|parameter name="action" string="true">complete</|DSML|parameter>',
  '</|DSML|invoke>',
  '</|DSML|tool_calls>',
].join('\n');

describe('a tool call the model wrote as text is recognized', () => {
  it('detects the dialect that was already handled', () => {
    expect(containsRawProviderToolCallMarkup(VENDOR_FUNCTION_DIALECT)).toBe(true);
  });

  it('detects the special-token dialect that reached the user', () => {
    expect(containsRawProviderToolCallMarkup(SPECIAL_TOKEN_DIALECT)).toBe(true);
  });

  it('does not depend on the namespace a given model uses', () => {
    // The traced case said DSML. The rule is the shape, not that word.
    const other = SPECIAL_TOKEN_DIALECT.replace(/DSML/g, 'tool_protocol.v2');
    expect(containsRawProviderToolCallMarkup(other)).toBe(true);
  });

  it('strips it, leaving the surrounding prose intact', () => {
    const text = `Here is the summary.\n\n${SPECIAL_TOKEN_DIALECT}\n\nDone.`;
    const stripped = stripRawProviderToolCallMarkupForDisplay(text);

    expect(stripped).toContain('Here is the summary.');
    expect(stripped).toContain('Done.');
    expect(stripped).not.toContain('DSML');
    expect(stripped).not.toContain('tool_calls');
  });

  it('still strips the dialect that was already handled', () => {
    const stripped = stripRawProviderToolCallMarkupForDisplay(
      `before ${VENDOR_FUNCTION_DIALECT} after`,
    );

    expect(stripped).not.toContain('tool_call');
    expect(stripped).not.toContain('function=');
    expect(stripped).toContain('before');
    expect(stripped).toContain('after');
  });
});

describe('ordinary text is never mistaken for a tool call', () => {
  it('ignores an answer that merely talks about the protocol', () => {
    const prose =
      'Some providers emit a batch inside <|DSML|tool_calls> when the tool channel is ' +
      'unavailable, which is why the parser looks for an invoke element.';

    expect(containsRawProviderToolCallMarkup(prose)).toBe(false);
    expect(stripRawProviderToolCallMarkupForDisplay(prose)).toBe(prose);
  });

  it('ignores a container with no invocation inside it', () => {
    const text = '<|DSML|tool_calls>\n</|DSML|tool_calls>';
    expect(containsRawProviderToolCallMarkup(text)).toBe(false);
  });

  it('ignores an unclosed container', () => {
    const text = '<|DSML|tool_calls>\n<|DSML|invoke name="update_goals">';
    expect(containsRawProviderToolCallMarkup(text)).toBe(false);
  });

  it('handles empty input', () => {
    expect(containsRawProviderToolCallMarkup('')).toBe(false);
    expect(stripRawProviderToolCallMarkupForDisplay('')).toBe('');
  });

  it('is not left stateful by a previous match', () => {
    // A global regex reused via .test() advances lastIndex and would alternate.
    expect(containsRawProviderToolCallMarkup(SPECIAL_TOKEN_DIALECT)).toBe(true);
    expect(containsRawProviderToolCallMarkup(SPECIAL_TOKEN_DIALECT)).toBe(true);
    expect(containsRawProviderToolCallMarkup(VENDOR_FUNCTION_DIALECT)).toBe(true);
    expect(containsRawProviderToolCallMarkup(VENDOR_FUNCTION_DIALECT)).toBe(true);
  });
});
