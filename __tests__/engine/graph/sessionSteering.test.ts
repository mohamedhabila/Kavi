import { deliverSteeringMessages } from '../../../src/engine/graph/sessionSteering';
import type {
  AgentControlGraphIterationRuntimeState,
  ToolRuntimeBindings,
} from '../../../src/engine/graph/iterationExecutionTypes';
import type { Message } from '../../../src/types/message';

function steer(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: 1, steerOfRunId: 'run-1' };
}

describe('deliverSteeringMessages', () => {
  it('keeps everything said earlier in the turn quotable as the current message moves on', () => {
    const runtime = { workingMessages: [] } as unknown as AgentControlGraphIterationRuntimeState;
    const toolRuntime = {
      currentUserMessage: { id: 'request', text: 'Plan dinner. Amira is vegetarian.' },
    } as unknown as ToolRuntimeBindings;
    const recordDelivery = jest.fn();

    const first = deliverSteeringMessages({
      takeSteeringMessages: () => [steer('steer-1', 'Friday.'), steer('steer-2', 'For six.')],
      runtime,
      toolRuntime,
      recordDelivery,
    });
    const second = deliverSteeringMessages({
      takeSteeringMessages: () => [steer('steer-3', 'Near the office.')],
      runtime: first.runtime,
      toolRuntime: first.toolRuntime,
      recordDelivery,
    });

    expect(second.toolRuntime.currentUserMessage).toEqual({
      id: 'steer-3',
      text: 'Near the office.',
      earlierInTurn: [
        { id: 'request', text: 'Plan dinner. Amira is vegetarian.' },
        { id: 'steer-1', text: 'Friday.' },
        { id: 'steer-2', text: 'For six.' },
      ],
    });
    expect(second.runtime.workingMessages.map((message) => message.id)).toEqual([
      'steer-1',
      'steer-2',
      'steer-3',
    ]);
    expect(recordDelivery.mock.calls).toEqual([[2], [1]]);
  });

  it('changes nothing when no message is waiting', () => {
    const runtime = { workingMessages: [] } as unknown as AgentControlGraphIterationRuntimeState;
    const toolRuntime = {} as ToolRuntimeBindings;
    const recordDelivery = jest.fn();

    const result = deliverSteeringMessages({
      takeSteeringMessages: () => [],
      runtime,
      toolRuntime,
      recordDelivery,
    });

    expect(result.runtime).toBe(runtime);
    expect(result.toolRuntime).toBe(toolRuntime);
    expect(recordDelivery).not.toHaveBeenCalled();
  });
});
