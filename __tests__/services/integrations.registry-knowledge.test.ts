import {
  installServiceIntegrationsReset,
  createKnowledgeSkill,
  mockFetch,
  registerBuiltInServiceSkills,
  registerSkill,
} from '../helpers/serviceIntegrationsHarness';

describe('Service Integrations', () => {
  installServiceIntegrationsReset();

  describe('registerBuiltInServiceSkills', () => {
    it('should register 7 skills', () => {
      registerBuiltInServiceSkills();
      expect(registerSkill).toHaveBeenCalledTimes(7);
    });
  });

  describe('createKnowledgeSkill — non-Error throw handling', () => {
    it('wikipedia_summary handles non-Error thrown value', async () => {
      mockFetch.mockRejectedValueOnce('DNS failure');
      const skill = createKnowledgeSkill();
      const result = await skill.tools[0].handler!({ topic: 'test' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('DNS failure');
    });

    it('define_word handles non-Error thrown value', async () => {
      mockFetch.mockRejectedValueOnce(42);
      const skill = createKnowledgeSkill();
      const result = await skill.tools[1].handler!({ word: 'test' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('42');
    });
  });
});
