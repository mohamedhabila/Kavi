import {
  getToolManagerCategoryForToolName,
  TOOL_CATEGORIES,
} from '../../src/engine/tools/toolManagerCategories';

describe('tool manager categories', () => {
  it('keeps every calendar mutation visible in the calendar category', () => {
    const calendar = TOOL_CATEGORIES.find((category) => category.name === 'calendar');

    expect(calendar?.toolNames).toEqual(
      expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
    );
    expect(getToolManagerCategoryForToolName('calendar_update_event')).toBe('calendar');
  });
});
