import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('buildUnknownToolResult — suggested contract description grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 400-char description budget`, () => {
      jest.resetModules();
      const description = buildBoundaryStraddlingText(400, cluster, 200);
      jest.doMock('../../../src/engine/tools/definitions', () => ({
        TOOL_DEFINITIONS: [
          {
            name: 'calendar_list_events',
            description,
            input_schema: { type: 'object', properties: {} },
          },
        ],
      }));

      const { buildUnknownToolResult } = require('../../../src/engine/toolExecution/unknownToolSuggestion');
      const result: string = buildUnknownToolResult({ toolName: 'calendar_list_event' });

      expect(result).toContain('calendar_list_events');
      expectGraphemeSafe(result);
    });
  }
});
