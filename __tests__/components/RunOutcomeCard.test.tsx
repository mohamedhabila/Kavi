import React from 'react';
import { render } from '@testing-library/react-native';
import { RunOutcomeCard } from '../../src/components/chat/RunOutcomeCard';
import type { ToolCall } from '../../src/types/message';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  MessageBubble,
  installMessageBubbleTestHarness,
  makeMessage,
} from '../helpers/messageBubbleHarness';

function call(
  id: string,
  name: string,
  args: Record<string, unknown>,
  effect?: Pick<ToolEffectReceipt, 'effectKind' | 'effectState'> & Partial<ToolEffectReceipt>,
): ToolCall {
  return {
    id,
    name,
    arguments: JSON.stringify(args),
    status: 'completed',
    ...(effect
      ? {
          effectReceipts: [
            {
              version: 2,
              receiptId: `ter_${id}`,
              toolCallId: id,
              toolName: name,
              contractIdentity: {} as ToolEffectReceipt['contractIdentity'],
              executionRunId: 'run-1',
              transportState: 'returned',
              verificationState: 'verified',
              requestDigest: 'sha256:a',
              resultDigest: 'sha256:b',
              recordedAt: 1,
              ...effect,
            } as ToolEffectReceipt,
          ],
        }
      : {}),
  };
}

const TRIP_CALLS: ToolCall[] = [
  call(
    'read',
    'read_file',
    { path: 'inbox/01.txt' },
    { effectKind: 'observation.read', effectState: 'none' },
  ),
  call(
    'write',
    'write_file',
    { path: 'trips/lisbon.md' },
    {
      effectKind: 'artifact.write',
      effectState: 'applied',
      resource: { kind: 'workspace_file', id: 'trips/lisbon.md' },
    },
  ),
  call(
    'reminder',
    'reminder',
    { title: 'Check in online' },
    { effectKind: 'reminder.schedule', effectState: 'failed' },
  ),
];

describe('RunOutcomeCard', () => {
  it('lists what the reply changed and what did not go through, in plain words', () => {
    const screen = render(<RunOutcomeCard toolCalls={TRIP_CALLS} />);

    expect(screen.getByText('What was done')).toBeTruthy();
    expect(screen.getByText('Saved a file')).toBeTruthy();
    expect(screen.getByText('trips/lisbon.md')).toBeTruthy();
    expect(screen.getByTestId('run-outcome-failed')).toBeTruthy();
    expect(screen.getByText('Check in online')).toBeTruthy();
    expect(screen.queryByText('inbox/01.txt')).toBeNull();
  });

  it('renders nothing for a reply that changed nothing', () => {
    const screen = render(
      <RunOutcomeCard
        toolCalls={[
          call(
            'read',
            'read_file',
            { path: 'a.md' },
            { effectKind: 'observation.read', effectState: 'none' },
          ),
        ]}
      />,
    );

    expect(screen.queryByTestId('run-outcome-card')).toBeNull();
  });
});

describe('a reply with what it did', () => {
  installMessageBubbleTestHarness();

  it('shows the card under a finished reply, not while it is still being written', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Your trip sheet is ready.',
      toolCalls: TRIP_CALLS,
    });

    expect(render(<MessageBubble message={msg} />).getByTestId('run-outcome-card')).toBeTruthy();
    expect(
      render(<MessageBubble message={msg} isStreaming={true} />).queryByTestId('run-outcome-card'),
    ).toBeNull();
  });
});
