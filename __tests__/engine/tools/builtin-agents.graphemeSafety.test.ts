jest.mock('../../../src/services/agents/registry', () => ({
  getAvailablePersonas: jest.fn().mockReturnValue([]),
  getPersona: jest.fn().mockReturnValue(undefined),
  isBuiltInPersona: jest.fn().mockReturnValue(false),
}));

const mockUpsertCustomPersona = jest.fn();
jest.mock('../../../src/services/agents/store', () => ({
  usePersonaConfigStore: {
    getState: () => ({
      upsertCustomPersona: mockUpsertCustomPersona,
    }),
  },
}));

import { executeAgentsConfigure } from '../../../src/engine/tools/builtin-agents';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeAgentsConfigure — description fallback grapheme safety', () => {
  beforeEach(() => {
    mockUpsertCustomPersona.mockClear();
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 100-char system-prompt-derived description budget`, async () => {
      const systemPrompt = buildBoundaryStraddlingText(100, cluster, 100);
      await executeAgentsConfigure({
        personaId: 'custom-1',
        systemPrompt,
      });

      expect(mockUpsertCustomPersona).toHaveBeenCalledTimes(1);
      const created = mockUpsertCustomPersona.mock.calls[0][0];
      expectGraphemeSafe(String(created.description ?? ''));
      expect(endsOnGraphemeBoundary(systemPrompt, String(created.description ?? ''))).toBe(true);
    });
  }
});
