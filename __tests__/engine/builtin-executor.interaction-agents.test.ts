const mockRecallFactSelectionForQuery = jest.fn();
const mockMarkFactsRecalled = jest.fn();

jest.mock('../../src/services/memory/factRecall', () => ({
  recallFactSelectionForQuery: (...args: any[]) => mockRecallFactSelectionForQuery(...args),
}));

jest.mock('../../src/services/memory/facts/observations', () => ({
  loadActiveMemoryFactConflictSignals: jest.fn().mockReturnValue([]),
}));

jest.mock('../../src/services/memory/facts/factAccessMutations', () => ({
  markFactsRecalled: (...args: any[]) => mockMarkFactsRecalled(...args),
}));

jest.mock('../../src/services/memory/entities', () => ({
  getEntityById: () => undefined,
}));

jest.mock('../../src/services/memory/memoryScopeStore', () => ({
  resolveLocalMemoryAccessScope: (scope: Record<string, unknown>) => ({
    memoryOwnerId: 'test-memory-owner',
    ...scope,
  }),
}));

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
import { makeScoredFact } from '../helpers/memoryFactFixtures';

describe('builtin executor interaction, agent, and memory tools', () => {
  installBuiltinExecutorRuntimeReset();

  beforeEach(() => {
    mockRecallFactSelectionForQuery.mockReset();
    mockRecallFactSelectionForQuery.mockResolvedValue({
      facts: [],
      resolutionFacts: [],
      scoredFacts: [],
    });
    mockMarkFactsRecalled.mockReset();
  });

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
      const scoredFacts = [
        makeScoredFact({
          fact: {
            id: 'fact-1',
            subjectId: 'subject-1',
            predicate: 'preference',
            objectText: 'User prefers dark mode',
            sourceRunId: 'run-1',
            memoryOwnerId: 'test-memory-owner',
            factClass: 'workflow',
            sourceAuthority: 'tool_observed',
            scope: 'global',
            originConversationId: null,
            originThreadId: null,
            originTaskId: null,
            memoryKind: 'semantic_fact',
          },
          score: 0.9,
        }),
        makeScoredFact({
          fact: {
            id: 'fact-2',
            subjectId: 'subject-2',
            predicate: 'event',
            objectText: 'Discussed project setup',
            sourceMessageId: 'message-2',
            memoryOwnerId: 'test-memory-owner',
            factClass: 'workflow',
            sourceAuthority: 'tool_observed',
            scope: 'conversation',
            originConversationId: 'conversation-1',
            originThreadId: 'conversation-1',
            contentHash: 'hash-2',
            memoryKind: 'episodic_event',
          },
          score: 0.6,
          importanceScore: 0.7,
        }),
      ];
      mockRecallFactSelectionForQuery.mockResolvedValueOnce({
        facts: scoredFacts.map((entry) => entry.fact),
        resolutionFacts: [],
        scoredFacts,
      });

      const result = await executeMemorySearch(
        { query: 'preferences' },
        {
          memoryConversationId: 'conversation-1',
          sourceThreadId: 'conversation-1',
          personaId: 'default',
          taskId: null,
        },
      );
      const parsed = JSON.parse(result);
      expect(parsed.method).toBe('living_memory');
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].citation).toBe('[1] run-1');
      expect(parsed.results[0].relevance).toBe('90%');
      expect(parsed.results[0].policy).toEqual({ action: 'use', reason: 'eligible' });
      expect(parsed.results[1].citation).toBe('[2] message-2');
      expect(mockMarkFactsRecalled).toHaveBeenCalledWith(['fact-1', 'fact-2'], expect.any(Number));
    });
  });
});
