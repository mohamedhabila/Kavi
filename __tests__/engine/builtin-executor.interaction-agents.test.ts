import {
  executeAgentsConfigure,
  executeAgentsList,
  executeAgentsSwitch,
  executeMessageEffect,
  executePollCreate,
  executeSpeak,
  installBuiltinExecutorRuntimeReset,
} from '../helpers/builtinExecutorRuntimeHarness';
import {
  failedToolContent,
  parseCompletedToolOutcome,
  parseFailedToolOutcome,
} from '../helpers/toolRuntimeOutcome';

describe('builtin executor interaction and agent tools', () => {
  installBuiltinExecutorRuntimeReset();

  describe('interactive helpers', () => {
    it('creates poll payloads with normalized options', async () => {
      const result = await executePollCreate({
        question: 'Pick a plan',
        options: ['Alpha', ' Beta ', ''],
      });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.status).toBe('created');
      expect(parsed.poll.options).toHaveLength(2);
      expect(parsed.poll.options[1].label).toBe('Beta');
    });

    it('validates message effect ids', async () => {
      const result = await executeMessageEffect({ effectId: 'confetti' });
      expect(parseCompletedToolOutcome(result).effectId).toBe('confetti');

      const invalid = await executeMessageEffect({ effectId: 'unknown' });
      expect(parseFailedToolOutcome(invalid).status).toBe('error');
    });
  });

  describe('executeSpeak', () => {
    it('speaks text with default provider', async () => {
      const voice = require('../../src/services/voice/voice');
      const result = await executeSpeak({ text: 'Hello world' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.status).toBe('spoken');
      expect(parsed.textLength).toBe(11);
      expect(parsed.provider).toBe('system');
      expect(voice.speakText).toHaveBeenCalledWith('Hello world', 'system');
    });

    it('speaks with specified provider', async () => {
      const voice = require('../../src/services/voice/voice');
      const result = await executeSpeak({ text: 'Hi', provider: 'openai' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.provider).toBe('openai');
      expect(voice.speakText).toHaveBeenCalledWith('Hi', 'openai');
    });

    it('handles speak errors', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.speakText.mockRejectedValueOnce(new Error('TTS unavailable'));

      const result = await executeSpeak({ text: 'Hi' });
      const parsed = parseFailedToolOutcome(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('TTS unavailable');
    });
  });

  describe('executeAgentsList', () => {
    it('returns built-in personas', async () => {
      const result = await executeAgentsList();
      const parsed = parseCompletedToolOutcome(result);
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
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.status).toBe('switched');
      expect(parsed.personaId).toBe('coder');
      expect(parsed.name).toBe('Coder');
    });

    it('returns error for unknown persona', async () => {
      const result = await executeAgentsSwitch({ personaId: 'unknown' });
      const content = failedToolContent(result);
      expect(content).toContain('Error');
      expect(content).toContain('persona not found');
    });
  });

  describe('executeAgentsConfigure', () => {
    it('creates a new custom persona', async () => {
      const result = await executeAgentsConfigure({
        personaId: 'custom-1',
        name: 'My Agent',
        systemPrompt: 'You are a custom agent.',
      });
      const parsed = parseCompletedToolOutcome(result);
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
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.status).toBe('configured');
      expect(parsed.persona.name).toBe('Agent B');
    });
  });
});
