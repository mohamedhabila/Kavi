const mockEmitSchedulerEvent = jest.fn();

jest.mock('../../src/services/events/bus', () => ({
  emitSchedulerEvent: (...args: unknown[]) => mockEmitSchedulerEvent(...args),
}));

import { AppState } from 'react-native';
import { emitActiveSchedulerEvent } from '../../src/services/scheduler/activeSchedulerEvent';

describe('active scheduler terminal events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AppState as { currentState: string }).currentState = 'active';
  });

  it('awaits hook dispatch before returning', async () => {
    let release!: () => void;
    let settled = false;
    mockEmitSchedulerEvent.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    const event = emitActiveSchedulerEvent('task_complete', { taskId: 'job-1' }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await event;
    expect(settled).toBe(true);
  });

  it('does not start detached hook work after backgrounding', async () => {
    (AppState as { currentState: string }).currentState = 'background';

    await emitActiveSchedulerEvent('task_failed', { taskId: 'job-1', error: 'failed' });

    expect(mockEmitSchedulerEvent).not.toHaveBeenCalled();
  });
});
