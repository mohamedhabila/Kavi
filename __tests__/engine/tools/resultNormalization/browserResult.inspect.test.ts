import { normalizeBrowserToolResult } from '../../../../src/engine/tools/resultNormalization/browserResult';
import { MAX_BROWSER_MESSAGES } from '../../../../src/engine/tools/resultNormalization/transformers';

// browser_inspect replaced browser_console, browser_errors and browser_network, but the
// result bounds stayed keyed on the old names, so every diagnostic a page logged reached
// the model's context.
describe('normalizeBrowserToolResult(browser_inspect)', () => {
  const total = MAX_BROWSER_MESSAGES + 25;

  it('bounds console messages', () => {
    const messages = Array.from({ length: total }, (_, index) => ({
      type: 'log',
      text: `message ${index}`,
    }));

    const parsed = JSON.parse(
      normalizeBrowserToolResult('browser_inspect', JSON.stringify({ targetId: 't1', messages })),
    );

    expect(parsed).toMatchObject({ count: total, omittedMessages: 25 });
    expect(parsed.messages).toHaveLength(MAX_BROWSER_MESSAGES);
  });

  it('bounds page errors', () => {
    const errors = Array.from({ length: total }, (_, index) => ({ message: `error ${index}` }));

    const parsed = JSON.parse(
      normalizeBrowserToolResult('browser_inspect', JSON.stringify({ targetId: 't1', errors })),
    );

    expect(parsed).toMatchObject({ count: total, omittedErrors: 25 });
    expect(parsed.errors).toHaveLength(MAX_BROWSER_MESSAGES);
  });

  it('bounds network requests and counts the failed ones', () => {
    const requests = Array.from({ length: total }, (_, index) => ({
      url: `https://example.test/${index}`,
      method: 'GET',
      status: index === 0 ? 500 : 200,
    }));

    const parsed = JSON.parse(
      normalizeBrowserToolResult('browser_inspect', JSON.stringify({ targetId: 't1', requests })),
    );

    expect(parsed).toMatchObject({ count: total, failedCount: 1, omittedRequests: 25 });
    expect(parsed.requests).toHaveLength(MAX_BROWSER_MESSAGES);
  });
});
