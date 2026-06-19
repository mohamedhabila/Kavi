// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSpawn part 1
// ---------------------------------------------------------------------------

import { executeSessionSpawn, MOCK_PROVIDER } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSpawn part 1', () => {
    it('launches a background sub-agent session by default', async () => {
      const result = await executeSessionSpawn(
        { prompt: 'Research something' },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.sessionId).toContain('sub-');
    });

    it('leaves exact-response worker prompts on the default text-only lane when tools are omitted', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      const result = await executeSessionSpawn(
        {
          prompt:
            "Please echo back exactly the string 'READY' so that the parent agent can capture it.",
        },
        'parent-conv-1',
        MOCK_PROVIDER,
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: undefined,
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('preserves explicit worker tool selections even for exact-response prompts', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      await executeSessionSpawn(
        {
          prompt: "Please echo back exactly the string 'READY'.",
          tools: ['read_file'],
        },
        'parent-conv-1',
        MOCK_PROVIDER,
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ['read_file'],
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('does not infer worker tool scope from prompt wording alone', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      await executeSessionSpawn(
        {
          prompt:
            'Use delegated worker to inspect package json and README md in this workspace. Local only. No remote tools.',
        },
        'parent-conv-1',
        MOCK_PROVIDER,
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: undefined,
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('passes worker prompts through without catalog-shape blocking', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      const result = await executeSessionSpawn(
        {
          prompt:
            'python, read_file, write_file, sessions_spawn, sessions_wait, web_search, web_fetch, canvas_read',
        },
        'parent-conv-1',
        MOCK_PROVIDER,
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt:
            'python, read_file, write_file, sessions_spawn, sessions_wait, web_search, web_fetch, canvas_read',
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('allows multilingual delegated prompts that mention a small explicit tool set', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      const result = await executeSessionSpawn(
        {
          prompt: 'افحص الملف المطلوب باستخدام read_file ثم احسب النتيجة باستخدام python.',
          tools: ['read_file', 'python'],
        },
        'parent-conv-1',
        MOCK_PROVIDER,
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'افحص الملف المطلوب باستخدام read_file ثم احسب النتيجة باستخدام python.',
          tools: ['read_file', 'python'],
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('allows concise delegated wait/output worker prompts', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      const result = await executeSessionSpawn(
        {
          prompt: "Wait 2 seconds, then print and return exactly 'READY'.",
          tools: ['python'],
        },
        'parent-conv-1',
        MOCK_PROVIDER,
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Wait 2 seconds, then print and return exactly 'READY'.",
          tools: ['python'],
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('propagates nested worker depth from the active parent session', async () => {
      const { getSubAgent, launchSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-parent',
        parentConversationId: 'parent-conv-1',
        depth: 0,
        status: 'running',
      });

      await executeSessionSpawn(
        { prompt: 'Investigate a nested issue' },
        'sub-parent',
        MOCK_PROVIDER,
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          parentSessionId: 'sub-parent',
          depth: 1,
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('ignores stale sub-agent snapshots that do not match the requested session id', async () => {
      const { getSubAgent, launchSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-stale-worker',
        parentConversationId: 'other-parent',
        depth: 1,
        status: 'completed',
      });

      const result = await executeSessionSpawn(
        { prompt: 'Research a supervisor task' },
        'parent-conv-1',
        MOCK_PROVIDER,
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
        }),
        MOCK_PROVIDER,
        undefined,
      );
      const config = launchSubAgent.mock.calls[0][0];
      expect(config.parentSessionId).toBeUndefined();
      expect(config.depth).toBeUndefined();
    });

    it('rejects nested worker spawn when mobile depth limit is exceeded', async () => {
      const { getSubAgent, launchSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-parent',
        parentConversationId: 'parent-conv-1',
        depth: 1,
        status: 'running',
      });

      const result = await executeSessionSpawn(
        { prompt: 'Attempt one more nesting level' },
        'sub-parent',
        MOCK_PROVIDER,
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('blocked');
      expect(parsed.error).toContain('Maximum sub-agent spawn depth');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('rejects missing or blank worker prompts before attempting launch', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      const result = await executeSessionSpawn(
        { prompt: '   ' as any },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('Worker prompt must be a non-empty string.');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });
  });
});
