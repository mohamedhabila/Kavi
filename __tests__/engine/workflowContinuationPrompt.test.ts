import { buildWorkflowContinuationPrompt } from '../../src/engine/graph/workflowContinuationPrompt';
import {
  CALENDAR_CREATE_TOOL,
  CALENDAR_LIST_TOOL,
  CALENDAR_UPDATE_TOOL,
} from '../../src/engine/tools/native/calendar/definitions';

describe('workflow continuation prompt', () => {
  const allTools = [CALENDAR_LIST_TOOL, CALENDAR_CREATE_TOOL, CALENDAR_UPDATE_TOOL];

  it('surfaces selected successors and their structural resource handoff', () => {
    const prompt = buildWorkflowContinuationPrompt({
      allTools,
      completedToolNames: new Set(['calendar_create_event']),
      selectedToolNames: new Set(['calendar_create_event', 'calendar_update_event']),
    });

    expect(prompt).toContain('calendar_create_event → calendar_update_event (calendar_event)');
    expect(prompt).toContain('Do not report a listed successor as unavailable.');
    expect(prompt).not.toContain('calendar_list');
  });

  it('omits completed or unavailable successors', () => {
    expect(
      buildWorkflowContinuationPrompt({
        allTools,
        completedToolNames: new Set(['calendar_create_event', 'calendar_update_event']),
        selectedToolNames: new Set(['calendar_create_event', 'calendar_update_event']),
      }),
    ).toBeNull();
    expect(
      buildWorkflowContinuationPrompt({
        allTools,
        completedToolNames: new Set(['calendar_create_event']),
        selectedToolNames: new Set(['calendar_create_event']),
      }),
    ).toBeNull();
  });
});
