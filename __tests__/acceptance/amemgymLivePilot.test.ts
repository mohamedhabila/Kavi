jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import { spawn } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import path from 'path';

import { buildE2EProvider } from '../../src/acceptance/e2eAgent/providerConfig';
import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { captureForegroundScenarioMemoryItems } from '../../src/acceptance/e2eAgent/foregroundScenarioMemoryItemsEvidence';
import { forgetConversationHistory } from '../../src/services/memory/core/memoryCapture';
import { forgetMemoryItem, getMemoryItem } from '../../src/services/memory/core/memoryItemsStore';
import type { Message } from '../../src/types/message';

type JsonObject = Record<string, unknown>;

type BridgeSession = {
  rootConversationId: string;
  messages: Message[];
  turnCount: number;
  /** Past turns indexed after the latest observation; a question turn must not add any. */
  indexedTurnCount: number;
};

const describeLivePilot = process.env.RUN_AMEMGYM_PILOT === '1' ? describe : describe.skip;

function sendJson(response: ServerResponse, status: number, body: JsonObject): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(encoded),
  });
  response.end(encoded);
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error('bridge_request_too_large');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('bridge_request_must_be_object');
  }
  return parsed as JsonObject;
}

function requirePayloadText(payload: JsonObject, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`bridge_${field}_invalid`);
  }
  return value;
}

function cloneMessages(messages: ReadonlyArray<Message>): Message[] {
  return JSON.parse(JSON.stringify(messages)) as Message[];
}

function usagePayload(turn: Awaited<ReturnType<typeof runForegroundScenario>>['turns'][number]) {
  return {
    input_tokens: turn.usage?.totalInput ?? 0,
    output_tokens: turn.usage?.totalOutput ?? 0,
    total_tokens: turn.usage?.totalTokens ?? 0,
    time_elapsed: turn.durationMs / 1_000,
  };
}

function memoryPromptDiagnostics(
  turn: Awaited<ReturnType<typeof runForegroundScenario>>['turns'][number],
) {
  return {
    status: turn.memoryPrompt.status,
    builds: turn.memoryPrompt.builds.map((build) => ({
      item_count: build.itemIds.length,
      past_turn_count: build.turnIds.length,
      prompt_chars: build.chars,
      duration_ms: build.durationMs,
    })),
  };
}

function selectedMemoryItemTexts(
  turn: Awaited<ReturnType<typeof runForegroundScenario>>['turns'][number],
): string[] {
  const selectedIds = new Set(turn.memoryPrompt.builds.flatMap((build) => build.itemIds));
  return [...selectedIds].flatMap((id) => {
    const item = getMemoryItem(id);
    return item ? [item.text] : [];
  });
}

function requireCompletedTurn(
  result: Awaited<ReturnType<typeof runForegroundScenario>>,
): Awaited<ReturnType<typeof runForegroundScenario>>['turns'][number] {
  const turn = result.turns[0];
  if (
    !turn ||
    turn.error ||
    turn.timedOut ||
    !turn.completion.finalResponseCompleted ||
    turn.finalAssistant?.completionStatus !== 'complete' ||
    !turn.finalAssistant.text.trim()
  ) {
    throw new Error(`foreground_chat_incomplete:${turn?.error ?? 'missing_final'}`);
  }
  return turn;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bridge_address_unavailable');
  return address.port;
}

async function runPilotProcess(params: {
  bridgeUrl: string;
  bridgeToken: string;
}): Promise<number> {
  const projectRoot = path.resolve(__dirname, '../..');
  const python = requirePayloadText(process.env as JsonObject, 'AMEMGYM_PYTHON');
  const upstreamDir = requirePayloadText(process.env as JsonObject, 'AMEMGYM_UPSTREAM_DIR');
  const dataFile = requirePayloadText(process.env as JsonObject, 'AMEMGYM_DATA_FILE');
  const outputDir = requirePayloadText(process.env as JsonObject, 'AMEMGYM_OUTPUT_DIR');
  const minimumAccuracy = process.env.AMEMGYM_PILOT_MIN_ACCURACY || String(2 / 3);
  const periodIndices = process.env.AMEMGYM_PILOT_PERIOD_INDICES || '0,1,3';
  const itemIndex = process.env.AMEMGYM_PILOT_ITEM_INDEX || '0';
  const qaIndex = process.env.AMEMGYM_PILOT_QA_INDEX || '0';
  const child = spawn(
    python,
    [
      path.join(projectRoot, 'benchmarks/amemgym/run_kavi_pilot.py'),
      '--upstream-dir',
      upstreamDir,
      '--data-file',
      dataFile,
      '--output-dir',
      outputDir,
      '--min-accuracy',
      minimumAccuracy,
      '--item-index',
      itemIndex,
      '--qa-index',
      qaIndex,
      '--period-indices',
      periodIndices,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        KAVI_AMEMGYM_BRIDGE_URL: params.bridgeUrl,
        KAVI_AMEMGYM_BRIDGE_TOKEN: params.bridgeToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));

  return await new Promise<number>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error('AMemGym pilot exceeded its 15 minute process deadline.'));
      },
      15 * 60 * 1_000,
    );
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });
}

describeLivePilot('AMemGym — exact foreground-chat live pilot', () => {
  jest.setTimeout(16 * 60 * 1_000);

  afterAll(() => {
    teardownE2EMemorySandbox();
  });

  it('meets the bounded on-policy memory bar without question-turn memory writes', async () => {
    resetE2EMemorySandbox();
    await useSettingsStore.persist.rehydrate();
    const provider = buildE2EProvider();
    const systemPrompt = useSettingsStore.getState().systemPrompt;
    const bridgeToken = randomBytes(32).toString('hex');
    const bridgeInstanceId = randomUUID();
    const sessions = new Map<string, BridgeSession>();

    const server = createServer((request, response) => {
      void (async () => {
        if (
          request.method !== 'POST' ||
          request.socket.remoteAddress !== '127.0.0.1' ||
          request.headers.authorization !== `Bearer ${bridgeToken}`
        ) {
          sendJson(response, 403, { ok: false, error: 'bridge_access_denied' });
          return;
        }
        const payload = await readJsonBody(request);
        const action = requirePayloadText(payload, 'action');
        const sessionId = requirePayloadText(payload, 'session_id');
        if (!/^[A-Za-z0-9._-]{1,100}$/u.test(sessionId)) {
          throw new Error('bridge_session_id_invalid');
        }

        if (action === 'reset') {
          resetE2EMemorySandbox();
          sessions.clear();
          sessions.set(sessionId, {
            rootConversationId: `amemgym-${sessionId}`,
            messages: [],
            turnCount: 0,
            indexedTurnCount: 0,
          });
          sendJson(response, 200, {
            ok: true,
            metadata: {
              bridge_instance_id: bridgeInstanceId,
              provider: {
                family: provider.providerFamily,
                model: provider.model,
                base_url: provider.baseUrl,
              },
            },
          });
          return;
        }

        const session = sessions.get(sessionId);
        if (!session) throw new Error('bridge_session_unavailable');

        if (action === 'save_state') {
          sendJson(response, 200, {
            ok: true,
            checkpoint: { turn_count: session.turnCount },
          });
          return;
        }
        if (action === 'load_state') {
          const checkpoint = payload.checkpoint;
          if (
            payload.bridge_instance_id !== bridgeInstanceId ||
            !checkpoint ||
            typeof checkpoint !== 'object' ||
            Array.isArray(checkpoint) ||
            (checkpoint as JsonObject).turn_count !== session.turnCount
          ) {
            throw new Error('bridge_checkpoint_unavailable');
          }
          sendJson(response, 200, { ok: true });
          return;
        }
        if (action === 'act') {
          const result = await runForegroundScenario({
            provider,
            conversationId: session.rootConversationId,
            conversationTitle: 'AMemGym live pilot',
            systemPrompt,
            initialMessages: session.messages,
            scenarioTimeoutMs: 240_000,
            timeoutMs: 120_000,
            memoryTimeoutMs: 90_000,
            maxTokens: 768,
            turns: [
              {
                content: requirePayloadText(payload, 'observation'),
              },
            ],
          });
          const turn = requireCompletedTurn(result);
          if (!turn.memoryExtractionSettled) throw new Error('foreground_memory_not_extracted');
          session.messages = cloneMessages(result.finalConversation.messages);
          session.turnCount += 1;
          session.indexedTurnCount = result.memoryItems.indexedTurnCount;
          sendJson(response, 200, {
            ok: true,
            response: turn.finalAssistant!.text,
            usage: usagePayload(turn),
            diagnostics: {
              memory_prompt: memoryPromptDiagnostics(turn),
              memory: {
                current_item_count: result.memoryItems.items.filter(
                  (item) => item.supersededBy === null,
                ).length,
                indexed_turn_count: result.memoryItems.indexedTurnCount,
              },
            },
          });
          return;
        }
        if (action === 'answer_question') {
          // Kavi is one conversation, so a read-only question runs in a throwaway one: memory
          // reads span conversations, and what the question left in memory is deleted with it.
          const questionConversationId = `${session.rootConversationId}-question-${session.turnCount}-${randomUUID()}`;
          const itemIdsBeforeQuestion = new Set(
            captureForegroundScenarioMemoryItems().items.map((item) => item.id),
          );
          const result = await runForegroundScenario({
            provider,
            conversationId: questionConversationId,
            conversationTitle: 'AMemGym read-only question',
            systemPrompt,
            initialMessages: [],
            scenarioTimeoutMs: 180_000,
            timeoutMs: 120_000,
            memoryTimeoutMs: 30_000,
            maxTokens: 256,
            turns: [
              {
                content: requirePayloadText(payload, 'question'),
              },
            ],
          });
          forgetConversationHistory(questionConversationId);
          for (const item of captureForegroundScenarioMemoryItems().items) {
            if (!itemIdsBeforeQuestion.has(item.id)) forgetMemoryItem(item.id);
          }
          useChatStore.setState((current) => ({
            conversations: current.conversations.filter(
              (conversation) => conversation.id !== questionConversationId,
            ),
            activeConversationId: session.rootConversationId,
          }));
          const turn = requireCompletedTurn(result);
          if (
            captureForegroundScenarioMemoryItems().indexedTurnCount !== session.indexedTurnCount
          ) {
            throw new Error('amemgym_question_turn_wrote_memory');
          }
          sendJson(response, 200, {
            ok: true,
            response: turn.finalAssistant!.text,
            usage: usagePayload(turn),
            diagnostics: {
              memory_prompt: memoryPromptDiagnostics(turn),
              private_response_text: turn.finalAssistant!.text,
              private_selected_memory_items: selectedMemoryItemTexts(turn),
            },
          });
          return;
        }
        throw new Error('bridge_action_unsupported');
      })().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'bridge_internal_error';
        sendJson(response, 500, { ok: false, error: message.slice(0, 1_000) });
      });
    });

    const port = await listenOnLoopback(server);
    try {
      const exitCode = await runPilotProcess({
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeToken,
      });
      expect(exitCode).toBe(0);
    } finally {
      await closeServer(server);
    }
  });
});
