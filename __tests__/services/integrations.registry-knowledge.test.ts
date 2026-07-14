import {
  installServiceIntegrationsReset,
  createKnowledgeSkill,
  mockFetch,
  registerBuiltInServiceSkills,
  registerCodeOwnedSkill,
} from '../helpers/serviceIntegrationsHarness';
import { failedToolContent } from '../helpers/toolRuntimeOutcome';

describe('Service Integrations', () => {
  installServiceIntegrationsReset();

  describe('registerBuiltInServiceSkills', () => {
    it('should register 7 skills', () => {
      registerBuiltInServiceSkills();
      expect(registerCodeOwnedSkill).toHaveBeenCalledTimes(7);
    });
  });

  describe('createKnowledgeSkill — non-Error throw handling', () => {
    it('wikipedia_summary handles non-Error thrown value', async () => {
      mockFetch.mockRejectedValueOnce('DNS failure');
      const skill = createKnowledgeSkill();
      const result = await skill.tools[0].handler!({ topic: 'test' });
      expect(failedToolContent(result)).toContain('DNS failure');
    });

    it('define_word handles non-Error thrown value', async () => {
      mockFetch.mockRejectedValueOnce(42);
      const skill = createKnowledgeSkill();
      const result = await skill.tools[1].handler!({ word: 'test' });
      expect(failedToolContent(result)).toContain('42');
    });
  });
});
