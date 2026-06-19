import { makeOnDeviceProviderConfig, makeTestProviderConfig } from '../fixtures/providers';

export const mockGetSelectableLocalLlmModels = jest.fn();
export const mockIsOnDeviceLlmProvider = jest.fn();
export const mockSendLocalLlmMessage = jest.fn();
export const mockStreamLocalLlmMessage = jest.fn();

jest.mock('../../src/services/localLlm/modelArtifacts', () => {
  const actual = jest.requireActual('../../src/services/localLlm/modelArtifacts');
  return {
    ...actual,
    getSelectableLocalLlmModels: (...args: any[]) => mockGetSelectableLocalLlmModels(...args),
  };
});

jest.mock('../../src/services/localLlm/provider', () => {
  const actual = jest.requireActual('../../src/services/localLlm/provider');
  return {
    ...actual,
    isOnDeviceLlmProvider: (...args: any[]) => mockIsOnDeviceLlmProvider(...args),
  };
});

jest.mock('../../src/services/localLlm/generateSession', () => {
  const actual = jest.requireActual('../../src/services/localLlm/generateSession');
  return {
    ...actual,
    sendLocalLlmMessage: (...args: any[]) => mockSendLocalLlmMessage(...args),
  };
});

jest.mock('../../src/services/localLlm/streamSession', () => {
  const actual = jest.requireActual('../../src/services/localLlm/streamSession');
  return {
    ...actual,
    streamLocalLlmMessage: (...args: any[]) => mockStreamLocalLlmMessage(...args),
  };
});

const llmServiceModule = jest.requireActual(
  '../../src/services/llm/LlmService',
) as typeof import('../../src/services/llm/LlmService');
const tokenOptimizationModule = jest.requireActual(
  '../../src/services/context/tokenOptimization',
) as typeof import('../../src/services/context/tokenOptimization');

export const { getGeminiPromptCacheTelemetrySnapshot, LlmService, resetGeminiPromptCacheForTests } =
  llmServiceModule;
export const { normalizeOpenAIPromptCacheKey, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH } =
  tokenOptimizationModule;

export const makeConfig = makeTestProviderConfig;

export const makeOnDeviceConfig = makeOnDeviceProviderConfig;

export const makeOpenAIResponsesPayload = (overrides: Record<string, any> = {}) => ({
  id: 'resp_test',
  status: 'completed',
  output: [
    {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'ok', annotations: [] }],
    },
  ],
  output_text: 'ok',
  usage: {
    input_tokens: 5,
    output_tokens: 2,
    input_tokens_details: {
      cached_tokens: 0,
    },
  },
  ...overrides,
});

export const makeExpoFailureToolResult = () => ({
  summary: 'Workflow workflow-run-77: FAILURE (FAILURE).',
  workflowRun: {
    id: 'workflow-run-77',
    status: 'FAILURE',
    conclusion: 'FAILURE',
  },
  jobs: [
    {
      name: 'Build',
      status: 'FAILURE',
      steps: [{ name: 'Install Dependencies', status: 'FAILURE' }],
    },
  ],
  failureLogs: [
    {
      source: 'Build / Install Dependencies',
      excerpt: 'npm ERR! code E404\nnpm ERR! 404 @kavi/private-package not found',
    },
  ],
  note: 'Fix the missing private package or registry access before retrying.',
});

export function createMockStreamResponse(chunks: string[]) {
  let index = 0;
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });

  return {
    ok: true,
    body: readableStream,
  };
}

export const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  jest.clearAllMocks();
  resetGeminiPromptCacheForTests();
  mockIsOnDeviceLlmProvider.mockImplementation(
    (provider: LlmProviderConfig) =>
      provider.kind === 'on-device' || Boolean(provider.local?.runtime),
  );
  mockGetSelectableLocalLlmModels.mockImplementation(
    (provider: LlmProviderConfig) => provider.availableModels || [provider.model],
  );
  mockSendLocalLlmMessage.mockResolvedValue({
    choices: [{ message: { content: 'Local reply' } }],
  });
  mockStreamLocalLlmMessage.mockImplementation(async function* () {
    yield { type: 'token', content: 'Local' };
    yield { type: 'done' };
  });
});
