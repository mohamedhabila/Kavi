import { fireEvent, render } from '@testing-library/react-native';
import { ToolCallDisplay } from '../../src/components/chat/ToolCallDisplay';
import { getToolCallFailurePresentation } from '../../src/components/chat/toolCallOutcomePresentation';
import type { ToolCall } from '../../src/types/message';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      border: '#333',
      danger: '#f00',
      dangerSoft: '#300',
      success: '#0f0',
      primary: '#08f',
      primarySoft: '#024',
      surfaceAlt: '#181818',
      warning: '#fc0',
      warningBackground: '#320',
      toolCard: '#111',
      toolCardHeader: '#222',
      codeBackground: '#000',
    },
  }),
  AppPalette: {},
}));

const makeToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: 'privacy-tool',
  name: 'read_file',
  arguments: '{"path":"safe.txt"}',
  status: 'completed',
  ...overrides,
});

describe('ToolCallDisplay privacy and recovery', () => {
  it('never renders secrets in previews, selectable details, or accessibility output', () => {
    const apiKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz123456';
    const bearerToken = 'bearer-value-that-must-never-render';
    const { getByTestId, toJSON } = render(
      <ToolCallDisplay
        toolCall={makeToolCall({
          arguments: JSON.stringify({ path: 'safe.txt', apiKey }),
          result: JSON.stringify({
            status: 'ok',
            headers: { Authorization: `Bearer ${bearerToken}` },
          }),
        })}
      />,
    );

    fireEvent.press(getByTestId('tool-call-disclosure-privacy-tool'));
    expect(JSON.stringify(toJSON())).not.toContain(apiKey);
    expect(JSON.stringify(toJSON())).not.toContain(bearerToken);

    fireEvent.press(getByTestId('tool-call-technical-disclosure-privacy-tool'));
    const renderedTree = JSON.stringify(toJSON());
    expect(renderedTree).toContain('[REDACTED]');
    expect(renderedTree).not.toContain(apiKey);
    expect(renderedTree).not.toContain(bearerToken);
  });

  it('redacts secrets from collapsed summaries and live progress', () => {
    const apiKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz123456';
    const bearerToken = 'bearer-value-that-must-never-render';
    const completed = render(
      <ToolCallDisplay
        toolCall={makeToolCall({
          name: 'ssh_exec',
          arguments: JSON.stringify({
            command: `curl -H "Authorization: Bearer ${bearerToken}" https://example.com`,
          }),
        })}
      />,
    );

    expect(JSON.stringify(completed.toJSON())).not.toContain(bearerToken);
    expect(JSON.stringify(completed.toJSON())).toContain('[REDACTED]');

    const running = render(
      <ToolCallDisplay
        toolCall={makeToolCall({
          status: 'running',
          progressText: `OPENROUTER_API_KEY=${apiKey}`,
        })}
      />,
    );
    expect(JSON.stringify(running.toJSON())).not.toContain(apiKey);
    expect(JSON.stringify(running.toJSON())).toContain('[REDACTED]');
  });

  it('redacts secrets from interactive poll content and option labels', () => {
    const apiKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz123456';
    const { toJSON } = render(
      <ToolCallDisplay
        toolCall={makeToolCall({
          name: 'poll_create',
          result: JSON.stringify({
            poll: {
              question: `Use ${apiKey}?`,
              options: [
                { id: 'yes', label: `Bearer ${apiKey}`, votes: 0 },
                { id: 'no', label: 'No', votes: 0 },
              ],
            },
          }),
        })}
      />,
    );

    const renderedTree = JSON.stringify(toJSON());
    expect(renderedTree).toContain('[REDACTED]');
    expect(renderedTree).not.toContain(apiKey);
  });

  it('warns against duplicate retries when an external effect is uncertain', () => {
    const { getByText, getByTestId, queryByText } = render(
      <ToolCallDisplay
        toolCall={makeToolCall({
          status: 'failed',
          error: JSON.stringify({
            code: 'tool_effect_reconciliation_required',
            error: 'The app could not verify the outcome.',
          }),
        })}
      />,
    );

    fireEvent.press(getByTestId('tool-call-disclosure-privacy-tool'));
    expect(getByText('Check before trying again')).toBeTruthy();
    expect(getByText(/Check the destination before making a new request/i)).toBeTruthy();
    expect(queryByText(/tool_effect_reconciliation_required/)).toBeNull();
  });

  it.each([
    [{ error: 'user_approval_denied' }, 'toolCall.outcomes.declinedTitle', 'warning'],
    [{ error: 'HTTP 403 forbidden' }, 'toolCall.outcomes.accessTitle', 'danger'],
    [{ failureKind: 'tool_filter' }, 'toolCall.outcomes.unavailableTitle', 'danger'],
    [{ error: 'Network connection timed out' }, 'toolCall.outcomes.connectionTitle', 'danger'],
    [{ failureKind: 'authority_revoked' }, 'toolCall.outcomes.stoppedTitle', 'warning'],
    [{ error: 'Unexpected provider response' }, 'toolCall.outcomes.failedTitle', 'danger'],
  ] as const)('maps failure evidence to actionable recovery copy', (overrides, titleKey, tone) => {
    expect(
      getToolCallFailurePresentation(
        makeToolCall({ status: 'failed', ...overrides } as Partial<ToolCall>),
      ),
    ).toEqual(expect.objectContaining({ titleKey, tone }));
  });
});
