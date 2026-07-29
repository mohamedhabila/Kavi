import { buildWorkflowContinuationPrompt } from '../../src/engine/graph/workflowContinuationPrompt';
import {
  NOTIFICATION_CANCEL_TOOL,
  NOTIFICATION_SCHEDULE_TOOL,
  NOTIFICATION_SEND_TOOL,
} from '../../src/engine/tools/native/notifications/definitions';

describe('workflow continuation prompt', () => {
  const allTools = [NOTIFICATION_SEND_TOOL, NOTIFICATION_SCHEDULE_TOOL, NOTIFICATION_CANCEL_TOOL];

  it('surfaces selected successors and their structural resource handoff', () => {
    const prompt = buildWorkflowContinuationPrompt({
      allTools,
      completedToolNames: new Set(['notification_schedule']),
      selectedToolNames: new Set(['notification_schedule', 'notification_cancel']),
    });

    expect(prompt).toContain('notification_schedule → notification_cancel (notification_id)');
    expect(prompt).toContain('Do not report a listed successor as unavailable.');
    expect(prompt).not.toContain('notification_send');
  });

  it('omits completed or unavailable successors', () => {
    expect(
      buildWorkflowContinuationPrompt({
        allTools,
        completedToolNames: new Set(['notification_schedule', 'notification_cancel']),
        selectedToolNames: new Set(['notification_schedule', 'notification_cancel']),
      }),
    ).toBeNull();
    expect(
      buildWorkflowContinuationPrompt({
        allTools,
        completedToolNames: new Set(['notification_schedule']),
        selectedToolNames: new Set(['notification_schedule']),
      }),
    ).toBeNull();
  });
});
