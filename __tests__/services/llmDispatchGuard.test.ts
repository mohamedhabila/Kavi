jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { finalizeProviderConfig } from '../../src/constants/api';
import { buildModelTurnMemoryPolicyBinding } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { buildModelTurnMemoryPolicyDispatchGuard } from '../../src/engine/graph/modelTurn/memoryPromptDispatchFence';
import { sendLlmMessage } from '../../src/services/llm/messageService';
import { streamLlmMessage } from '../../src/services/llm/streamService';
import { closeMemoryDb } from '../../src/services/memory/database';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../src/types/provider';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

const mockSendLocalLlmMessage = jest.fn();
const mockStreamLocalLlmMessage = jest.fn();
const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

jest.mock('../../src/services/localLlm/generateSession', () => ({
  sendLocalLlmMessage: (...args: unknown[]) => mockSendLocalLlmMessage(...args),
}));

jest.mock('../../src/services/localLlm/streamSession', () => ({
  streamLocalLlmMessage: (...args: unknown[]) => mockStreamLocalLlmMessage(...args),
}));

const provider = finalizeProviderConfig({
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  model: 'gpt-5-mini',
  enabled: true,
});

const anthropicProvider = finalizeProviderConfig({
  id: 'anthropic',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'test-key',
  model: 'claude-sonnet-4-6',
  enabled: true,
});

const geminiProvider = finalizeProviderConfig({
  id: 'gemini',
  name: 'Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'test-key',
  model: 'gemini-3-flash-preview',
  enabled: true,
});

const localProvider: LlmProviderConfig = {
  id: 'on-device',
  name: 'On-device',
  kind: 'on-device',
  protocol: 'local',
  baseUrl: '',
  apiKey: '',
  model: 'test-local-model',
  enabled: true,
  local: { runtime: 'litert-lm' },
};

const tools = [
  {
    name: 'read_record',
    description: 'Read a structured record.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

function anthropicSchemaRejection(): Response {
  return {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    text: () => Promise.resolve('tool schema is too complex'),
  } as Response;
}

describe('LLM provider dispatch guard', () => {
  beforeEach(() => {
    closeMemoryDb();
    sqliteMock.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    useSettingsStore.setState({ disableLongTermMemory: false });
    initializeMemoryPolicyObservation();
    mockSendLocalLlmMessage.mockReset();
    mockStreamLocalLlmMessage.mockReset();
  });

  afterEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
    closeMemoryDb();
  });

  it('fails a non-streaming request before transport invocation', async () => {
    const performFetch = jest.fn();
    const requestDispatchGuard = jest.fn(() => {
      throw new Error('request generation expired');
    });

    await expect(
      sendLlmMessage({
        provider,
        messages: [{ role: 'user', content: 'Continue' }],
        options: { requestDispatchGuard },
        performFetch,
      }),
    ).rejects.toThrow('request generation expired');
    expect(requestDispatchGuard).toHaveBeenCalledTimes(1);
    expect(performFetch).not.toHaveBeenCalled();
  });

  it('fails a streaming request before transport invocation', async () => {
    const performFetch = jest.fn();
    const requestDispatchGuard = jest.fn(() => {
      throw new Error('request generation expired');
    });
    const stream = streamLlmMessage({
      provider,
      messages: [{ role: 'user', content: 'Continue' }],
      options: { requestDispatchGuard },
      performFetch,
    });

    await expect(stream.next()).rejects.toThrow('request generation expired');
    expect(requestDispatchGuard).toHaveBeenCalledTimes(1);
    expect(performFetch).not.toHaveBeenCalled();
  });

  it('reauthorizes a non-streaming adapter retry before its second fetch', async () => {
    let authorized = true;
    const requestDispatchGuard = jest.fn(() => {
      if (!authorized) throw new Error('request generation expired');
    });
    const performFetch = jest.fn(async () => {
      authorized = false;
      return anthropicSchemaRejection();
    });

    await expect(
      sendLlmMessage({
        provider: anthropicProvider,
        messages: [{ role: 'user', content: 'Read the record.' }],
        options: { requestDispatchGuard, tools },
        performFetch,
      }),
    ).rejects.toThrow('request generation expired');

    expect(requestDispatchGuard).toHaveBeenCalledTimes(2);
    expect(performFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an adapter retry exactly when its memory projection expires', async () => {
    let now = 199;
    const binding = buildModelTurnMemoryPolicyBinding({
      ...captureCurrentModelTurnMemoryFence(),
      validUntil: 200,
    });
    const requestDispatchGuard = jest.fn(
      buildModelTurnMemoryPolicyDispatchGuard(binding, () => now),
    );
    const performFetch = jest.fn(async () => {
      now = 200;
      return anthropicSchemaRejection();
    });

    await expect(
      sendLlmMessage({
        provider: anthropicProvider,
        messages: [{ role: 'user', content: 'Read the record.' }],
        options: { requestDispatchGuard, tools },
        performFetch,
      }),
    ).rejects.toThrow('memory_prompt_epoch_expired');

    expect(requestDispatchGuard).toHaveBeenCalledTimes(2);
    expect(performFetch).toHaveBeenCalledTimes(1);
  });

  it('reauthorizes a streaming adapter retry before its second fetch', async () => {
    let authorized = true;
    const requestDispatchGuard = jest.fn(() => {
      if (!authorized) throw new Error('request generation expired');
    });
    const performFetch = jest.fn(async () => {
      authorized = false;
      return anthropicSchemaRejection();
    });
    const stream = streamLlmMessage({
      provider: anthropicProvider,
      messages: [{ role: 'user', content: 'Read the record.' }],
      options: { requestDispatchGuard, tools },
      performFetch,
    });

    await expect(stream.next()).rejects.toThrow('request generation expired');

    expect(requestDispatchGuard).toHaveBeenCalledTimes(2);
    expect(performFetch).toHaveBeenCalledTimes(1);
  });

  it('reauthorizes Gemini structured-output fallback without parsing error prose', async () => {
    let authorized = true;
    const requestDispatchGuard = jest.fn(() => {
      if (!authorized) throw new Error('request generation expired');
    });
    const performFetch = jest.fn(async () => {
      authorized = false;
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('非言語化された構造エラー'),
      } as Response;
    });

    await expect(
      sendLlmMessage({
        provider: geminiProvider,
        messages: [{ role: 'user', content: 'Return one structured record.' }],
        options: {
          requestDispatchGuard,
          structuredOutput: {
            mimeType: 'application/json',
            schema: {
              type: 'object',
              properties: { approved: { type: 'boolean' } },
              required: ['approved'],
            },
          },
        },
        performFetch,
      }),
    ).rejects.toThrow('request generation expired');

    expect(requestDispatchGuard).toHaveBeenCalledTimes(2);
    expect(performFetch).toHaveBeenCalledTimes(1);
  });

  it('guards each local generation once without invoking remote transport', async () => {
    const requestDispatchGuard = jest.fn();
    const performFetch = jest.fn();
    mockSendLocalLlmMessage.mockResolvedValue({ choices: [] });

    await sendLlmMessage({
      provider: localProvider,
      messages: [{ role: 'user', content: 'Continue' }],
      options: { requestDispatchGuard },
      performFetch,
    });

    expect(requestDispatchGuard).toHaveBeenCalledTimes(1);
    expect(mockSendLocalLlmMessage).toHaveBeenCalledTimes(1);
    expect(performFetch).not.toHaveBeenCalled();
  });

  it('guards each local streaming generation once without invoking remote transport', async () => {
    const requestDispatchGuard = jest.fn();
    const performFetch = jest.fn();
    mockStreamLocalLlmMessage.mockImplementation(async function* () {
      yield { type: 'done' };
    });

    const events = [];
    for await (const event of streamLlmMessage({
      provider: localProvider,
      messages: [{ role: 'user', content: 'Continue' }],
      options: { requestDispatchGuard },
      performFetch,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'done',
        completion: {
          completionStatus: 'complete',
          finishReason: 'local_runtime_done',
        },
      },
    ]);
    expect(requestDispatchGuard).toHaveBeenCalledTimes(1);
    expect(mockStreamLocalLlmMessage).toHaveBeenCalledTimes(1);
    expect(performFetch).not.toHaveBeenCalled();
  });
});
