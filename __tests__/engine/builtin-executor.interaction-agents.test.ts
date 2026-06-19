import {
  executeAgentsConfigure,
  executeAgentsList,
  executeAgentsSwitch,
  executeMemorySearch,
  executeMessageEffect,
  executePollCreate,
  executeSpeak,
  installBuiltinExecutorRuntimeReset,
} from '../helpers/builtinExecutorRuntimeHarness';

describe('builtin executor interaction, agent, and memory tools', () => {
  installBuiltinExecutorRuntimeReset();

  describe('interactive helpers', () => {
    it('creates poll payloads with normalized options', async () => {
      const result = await executePollCreate({
        question: 'Pick a plan',
        options: ['Alpha', ' Beta ', ''],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('created');
      expect(parsed.poll.options).toHaveLength(2);
      expect(parsed.poll.options[1].label).toBe('Beta');
    });

    it('validates message effect ids', async () => {
      const result = await executeMessageEffect({ effectId: 'confetti' });
      expect(JSON.parse(result).effectId).toBe('confetti');

      const invalid = await executeMessageEffect({ effectId: 'unknown' });
      expect(JSON.parse(invalid).status).toBe('error');
    });
  });


  describe('executeSpeak', () => {
    it('speaks text with default provider', async () => {
      const voice = require('../../src/services/voice/voice');
      const result = await executeSpeak({ text: 'Hello world' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('spoken');
      expect(parsed.textLength).toBe(11);
      expect(parsed.provider).toBe('system');
      expect(voice.speakText).toHaveBeenCalledWith('Hello world', 'system');
    });

    it('speaks with specified provider', async () => {
      const voice = require('../../src/services/voice/voice');
      const result = await executeSpeak({ text: 'Hi', provider: 'openai' });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('openai');
      expect(voice.speakText).toHaveBeenCalledWith('Hi', 'openai');
    });

    it('handles speak errors', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.speakText.mockRejectedValueOnce(new Error('TTS unavailable'));

      const result = await executeSpeak({ text: 'Hi' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('TTS unavailable');
    });
  });


  describe('executeAgentsList', () => {
    it('returns built-in personas', async () => {
      const result = await executeAgentsList();
      const parsed = JSON.parse(result);
      expect(parsed.agents).toBeDefined();
      expect(parsed.agents.length).toBeGreaterThanOrEqual(2);

      const names = parsed.agents.map((a: any) => a.name);
      expect(names).toContain('Assistant');
      expect(names).toContain('Coder');
    });
  });


  describe('executeAgentsSwitch', () => {
    it('switches to an existing persona', async () => {
      const result = await executeAgentsSwitch({ personaId: 'coder' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('switched');
      expect(parsed.personaId).toBe('coder');
      expect(parsed.name).toBe('Coder');
    });

    it('returns error for unknown persona', async () => {
      const result = await executeAgentsSwitch({ personaId: 'unknown' });
      expect(result).toContain('Error');
      expect(result).toContain('persona not found');
    });
  });


  describe('executeAgentsConfigure', () => {
    it('creates a new custom persona', async () => {
      const result = await executeAgentsConfigure({
        personaId: 'custom-1',
        name: 'My Agent',
        systemPrompt: 'You are a custom agent.',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('created');
      expect(parsed.persona.name).toBe('My Agent');
    });

    it('configures an existing persona', async () => {
      await executeAgentsConfigure({
        personaId: 'custom-2',
        name: 'Agent A',
        systemPrompt: 'Original prompt',
      });

      const result = await executeAgentsConfigure({
        personaId: 'custom-2',
        name: 'Agent B',
        temperature: 0.7,
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('configured');
      expect(parsed.persona.name).toBe('Agent B');
    });
  });


  describe('executeMemorySearch (with citations)', () => {
    it('returns citation-formatted results', async () => {
      const { sqliteHybridSearch } = require('../../src/services/memory/sqlite-store');
      sqliteHybridSearch.mockResolvedValueOnce([
        { source: 'MEMORY.md', snippet: 'User prefers dark mode', score: 0.9 },
        { source: 'daily/2024-01-15.md', snippet: 'Discussed project setup', score: 0.6 },
      ]);

      const result = await executeMemorySearch({ query: 'preferences' });
      const parsed = JSON.parse(result);
      expect(parsed.method).toBe('text');
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].citation).toBe('[1] MEMORY.md');
      expect(parsed.results[0].relevance).toBe('90%');
      expect(parsed.results[1].citation).toBe('[2] daily/2024-01-15.md');
    });
  });
});
