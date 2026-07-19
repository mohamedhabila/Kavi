jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import fs from 'node:fs';
import path from 'node:path';

import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import { buildE2EProvider } from '../../src/acceptance/e2eAgent/providerConfig';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { finalizeProviderConfig } from '../../src/constants/api';
import { LlmService } from '../../src/services/llm/LlmService';

const describeLivePilot =
  process.env.RUN_ATTACHMENT_GROUNDING_PILOT === '1' ? describe : describe.skip;

function readFixtureImage(): Buffer {
  const encoded = fs
    .readFileSync(path.resolve(__dirname, '../fixtures/attachment-grounding-proof.png.b64'), 'utf8')
    .replace(/\s+/g, '');
  const image = Buffer.from(encoded, 'base64');
  if (
    image.byteLength === 0 ||
    image.byteLength > 8_000_000 ||
    !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error('Attachment-grounding fixture must be a bounded PNG.');
  }
  return image;
}

describeLivePilot('attachment grounding — exact foreground chat', () => {
  jest.setTimeout(5 * 60 * 1_000);

  afterAll(() => {
    teardownE2EMemorySandbox();
  });

  it('answers from the current user-visible image without tools or memory', async () => {
    resetE2EMemorySandbox();
    const configuredProvider = buildE2EProvider();
    const discoveredModels = await new LlmService(configuredProvider).fetchModels();
    const provider = finalizeProviderConfig({
      ...configuredProvider,
      availableModels:
        discoveredModels.models.length > 0
          ? discoveredModels.models
          : configuredProvider.availableModels,
      modelCapabilities: {
        ...(configuredProvider.modelCapabilities ?? {}),
        ...discoveredModels.capabilities,
      },
    });
    const image = readFixtureImage();

    const result = await runForegroundScenario({
      provider,
      conversationId: `attachment-grounding-${Date.now()}`,
      conversationTitle: 'Attachment grounding',
      systemPrompt: 'You are a careful general mobile assistant. Ground answers in current evidence.',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 4 * 60 * 1_000,
      disableLongTermMemory: true,
      disableTools: true,
      enableCompaction: true,
      turns: [
        {
          content:
            'Read the attached field note. Reply with exactly the harbor access code and nothing else.',
          attachments: [
            {
              id: 'attachment-grounding-image',
              type: 'image',
              uri: 'inline://attachment-grounding-proof.png',
              name: 'attachment-grounding-proof.png',
              mimeType: 'image/png',
              size: image.byteLength,
              base64: image.toString('base64'),
            },
          ],
          route: 'production_auto',
          selectedMode: 'chitchat',
          timeoutMs: 3 * 60 * 1_000,
        },
      ],
    });

    const finalAssistant = result.finalConversation.messages.findLast(
      (message) => message.role === 'assistant',
    );
    expect(finalAssistant?.content.trim()).toBe('cobalt-maple-731');
    expect(finalAssistant?.toolCalls ?? []).toHaveLength(0);
    expect(result.turns[0]?.completion).toMatchObject({
      executionCompleted: true,
      finalResponseCompleted: true,
    });
  });
});
