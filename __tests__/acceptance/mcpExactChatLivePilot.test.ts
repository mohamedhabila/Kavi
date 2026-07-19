jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import { Server as McpProtocolServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';

import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import { buildE2EProvider } from '../../src/acceptance/e2eAgent/providerConfig';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { finalizeProviderConfig } from '../../src/constants/api';
import { LlmService } from '../../src/services/llm/LlmService';
import { mcpManager } from '../../src/services/mcp/manager';
import { useApprovalStore } from '../../src/services/remote/approvalStore';
import { resetRemoteStore, useRemoteStore } from '../../src/services/remote/store';
import type { McpServerConfig } from '../../src/types/remote';

type TripRecord = Readonly<{
  bookingId: string;
  pickupNote: string;
  revision: number;
}>;

type ProtocolCall = Readonly<{
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}>;

type TripLedger = {
  records: Map<string, TripRecord>;
  calls: ProtocolCall[];
  errors: string[];
};

type RunningTripLedgerServer = Readonly<{
  close(): Promise<void>;
  ledger: TripLedger;
  url: string;
}>;

const describeLivePilot = process.env.RUN_MCP_EXACT_CHAT_PILOT === '1' ? describe : describe.skip;

const TARGET_BOOKING_ID = 'R7N4';
const TARGET_PICKUP_NOTE = 'Meet at the north entrance at 07:10';

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function requireStringArgument(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`trip_ledger_${name}_invalid`);
  }
  return value.trim();
}

function requireRevisionArgument(args: Readonly<Record<string, unknown>>): number {
  const value = args.expectedRevision;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('trip_ledger_expected_revision_invalid');
  }
  return Number(value);
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startTripLedgerServer(): Promise<RunningTripLedgerServer> {
  const ledger: TripLedger = {
    records: new Map([
      [
        TARGET_BOOKING_ID,
        {
          bookingId: TARGET_BOOKING_ID,
          pickupNote: '',
          revision: 0,
        },
      ],
      [
        'OTHER-22',
        {
          bookingId: 'OTHER-22',
          pickupNote: 'Leave unchanged',
          revision: 4,
        },
      ],
    ]),
    calls: [],
    errors: [],
  };
  const protocolServer = new McpProtocolServer(
    { name: 'trip-ledger-live-pilot', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  protocolServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_trip_record',
        description:
          'Read one Trip Ledger record by bookingId.\n\nReturns status found or not_found and the current revision. This tool does not change state.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { bookingId: { type: 'string', minLength: 1 } },
          required: ['bookingId'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'put_trip_note',
        description:
          'Create or update one Trip Ledger pickup note only when expectedRevision matches the current revision. This changes remote state. Read the record afterward to verify it.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            bookingId: { type: 'string', minLength: 1 },
            pickupNote: { type: 'string', minLength: 1 },
            expectedRevision: { type: 'integer', minimum: 0 },
          },
          required: ['bookingId', 'pickupNote', 'expectedRevision'],
        },
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
    ],
  }));

  protocolServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args =
      request.params.arguments && typeof request.params.arguments === 'object'
        ? (request.params.arguments as Record<string, unknown>)
        : {};
    ledger.calls.push({ name: request.params.name, arguments: { ...args } });

    try {
      if (request.params.name === 'get_trip_record') {
        const bookingId = requireStringArgument(args, 'bookingId');
        const record = ledger.records.get(bookingId);
        return record
          ? textResult({ status: 'found', record })
          : textResult({ status: 'not_found', bookingId, revision: 0 });
      }

      if (request.params.name === 'put_trip_note') {
        const bookingId = requireStringArgument(args, 'bookingId');
        const pickupNote = requireStringArgument(args, 'pickupNote');
        const expectedRevision = requireRevisionArgument(args);
        const current = ledger.records.get(bookingId);
        const currentRevision = current?.revision ?? 0;
        if (expectedRevision !== currentRevision) {
          return textResult(
            {
              status: 'revision_conflict',
              bookingId,
              expectedRevision,
              currentRevision,
            },
            true,
          );
        }
        const record: TripRecord = {
          bookingId,
          pickupNote,
          revision: currentRevision + 1,
        };
        ledger.records.set(bookingId, record);
        return textResult({ status: 'updated', record });
      }

      return textResult({ status: 'unknown_tool', name: request.params.name }, true);
    } catch (error) {
      return textResult(
        {
          status: 'invalid_arguments',
          message: error instanceof Error ? error.message : String(error),
        },
        true,
      );
    }
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
  });
  protocolServer.onerror = (error) => ledger.errors.push(`protocol: ${error.message}`);
  transport.onerror = (error) => ledger.errors.push(`transport: ${error.message}`);
  await protocolServer.connect(transport);
  const httpServer = createServer((request, response) => {
    if (request.url !== '/mcp' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    void transport.handleRequest(request, response).catch((error) => {
      ledger.errors.push(`request: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    await protocolServer.close();
    await closeHttpServer(httpServer);
    throw new Error('trip_ledger_server_address_unavailable');
  }

  return {
    ledger,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await protocolServer.close();
      await closeHttpServer(httpServer);
    },
  };
}

describeLivePilot('MCP integration — exact foreground chat', () => {
  jest.setTimeout(6 * 60 * 1_000);

  afterAll(() => {
    mcpManager.disconnectAll();
    teardownE2EMemorySandbox();
  });

  it('keeps a discovered integration reachable for a follow-up update and verification', async () => {
    resetE2EMemorySandbox();
    resetRemoteStore();
    mcpManager.disconnectAll();
    const tripLedger = await startTripLedgerServer();
    const approvalSnapshot = useApprovalStore.getState();
    const mcpConfig: McpServerConfig = {
      id: 'trip_ledger',
      name: 'Trip Ledger',
      url: tripLedger.url,
      transport: 'streamable-http',
      enabled: true,
      tools: [],
      allowedTools: [],
      trust: { source: 'manual' },
      trustToolAnnotations: true,
    };

    try {
      await mcpManager.connectServer(mcpConfig).catch((error) => {
        const clientError = error instanceof Error ? error.message : String(error);
        throw new Error(
          `trip_ledger_connect_failed: ${clientError}; server=${tripLedger.ledger.errors.join(' | ')}`,
        );
      });
      expect(mcpManager.getStatus(mcpConfig.id)).toMatchObject({
        state: 'connected',
        tools: [{ name: 'get_trip_record' }, { name: 'put_trip_note' }],
      });
      useApprovalStore.getState().addToAllowlist('mcp__trip_ledger__get_trip_record');
      useApprovalStore.getState().addToAllowlist('mcp__trip_ledger__put_trip_note');

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
      let result: Awaited<ReturnType<typeof runForegroundScenario>>;
      try {
        result = await runForegroundScenario({
          provider,
          conversationId: `mcp-trip-ledger-${Date.now()}`,
          conversationTitle: 'Trip Ledger pickup note',
          systemPrompt:
            'You are a careful general mobile assistant. Use connected integrations when needed, preserve user constraints, and verify changed state before claiming completion.',
          defaultMode: 'agentic',
          scenarioTimeoutMs: 4 * 60 * 1_000,
          timeoutMs: 2 * 60 * 1_000,
          maxTokens: 4_096,
          disableLongTermMemory: true,
          enableCompaction: true,
          turns: [
            {
              content:
                `In my Trip Ledger integration, read booking ${TARGET_BOOKING_ID} and tell me its current pickup note. ` +
                'Do not change anything.',
              route: 'production_auto',
              selectedMode: 'agentic',
            },
            {
              content:
                `Now set the pickup note on that same booking to exactly "${TARGET_PICKUP_NOTE}", then read it back. ` +
                'Tell me it is done only if the read-back matches. Do not change any other record.',
              route: 'production_auto',
              selectedMode: 'agentic',
            },
          ],
        });
      } catch (error) {
        throw new Error(
          `mcp_exact_chat_driver_failed: ${JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            calls: tripLedger.ledger.calls,
            approvals: useApprovalStore
              .getState()
              .getPendingRequests()
              .map((request) => ({ toolName: request.toolName, status: request.status })),
            remoteJobs: Object.values(useRemoteStore.getState().jobs).map((job) => ({
              toolName: job.toolName,
              status: job.status,
              error: job.error,
            })),
            serverErrors: tripLedger.ledger.errors,
          })}`,
        );
      }

      const diagnostic = () =>
        JSON.stringify({
          calls: tripLedger.ledger.calls,
          turns: result.turns.map((turn) => ({
            completion: turn.completion,
            finalAssistant: turn.finalAssistant,
            messages: turn.messages.map((message) => ({
              role: message.role,
              content: message.content,
              toolCallId: message.toolCallId,
              toolCalls: message.toolCalls?.map((call) => ({
                id: call.id,
                name: call.name,
                arguments: call.arguments,
                status: call.status,
                result: call.result,
                error: call.error,
                effectReceipts: call.effectReceipts,
              })),
            })),
          })),
          remoteJobs: Object.values(useRemoteStore.getState().jobs),
          runs: result.turns.map((turn) =>
            turn.run
              ? {
                  status: turn.run.status,
                  terminalReason: turn.run.terminalReason,
                  summary: turn.run.summary,
                  checkpoints: turn.run.checkpoints,
                  controlGraph: turn.run.controlGraph,
                }
              : null,
          ),
          serverErrors: tripLedger.ledger.errors,
          targetRecord: tripLedger.ledger.records.get(TARGET_BOOKING_ID),
        });

      if (
        result.turns.length !== 2 ||
        result.turns.some(
          (turn) =>
            turn.completion.executionCompleted !== true ||
            turn.completion.finalResponseCompleted !== true ||
            turn.completion.runStatus !== 'completed' ||
            turn.completion.graphStatus !== 'finalized',
        )
      ) {
        throw new Error(`mcp_exact_chat_completion_failed: ${diagnostic()}`);
      }

      for (const turn of result.turns) {
        expect(turn.completion).toMatchObject({
          executionCompleted: true,
          finalResponseCompleted: true,
          runStatus: 'completed',
          graphStatus: 'finalized',
        });
        expect(turn.error).toBeNull();
      }
      const firstTurnToolNames = result.turns[0]?.messages.flatMap(
        (message) => message.toolCalls?.map((call) => call.name) ?? [],
      );
      const secondTurnToolNames = result.turns[1]?.messages.flatMap(
        (message) => message.toolCalls?.map((call) => call.name) ?? [],
      );
      expect(firstTurnToolNames).toContain('mcp__trip_ledger__get_trip_record');
      expect(firstTurnToolNames).not.toContain('mcp__trip_ledger__put_trip_note');
      expect(secondTurnToolNames).toContain('mcp__trip_ledger__put_trip_note');
      expect(secondTurnToolNames).toContain('mcp__trip_ledger__get_trip_record');
      const targetRecord = tripLedger.ledger.records.get(TARGET_BOOKING_ID);
      if (!targetRecord) {
        throw new Error(`mcp_exact_chat_target_missing: ${diagnostic()}`);
      }
      expect(targetRecord).toEqual({
        bookingId: TARGET_BOOKING_ID,
        pickupNote: TARGET_PICKUP_NOTE,
        revision: 1,
      });
      expect(tripLedger.ledger.records.get('OTHER-22')).toEqual({
        bookingId: 'OTHER-22',
        pickupNote: 'Leave unchanged',
        revision: 4,
      });

      const mutationCalls = tripLedger.ledger.calls.filter((call) => call.name === 'put_trip_note');
      expect(mutationCalls).toHaveLength(1);
      expect(mutationCalls[0]?.arguments).toEqual({
        bookingId: TARGET_BOOKING_ID,
        pickupNote: TARGET_PICKUP_NOTE,
        expectedRevision: 0,
      });
      const mutationIndex = tripLedger.ledger.calls.findIndex(
        (call) => call.name === 'put_trip_note',
      );
      expect(
        tripLedger.ledger.calls
          .slice(0, mutationIndex)
          .some(
            (call) =>
              call.name === 'get_trip_record' && call.arguments.bookingId === TARGET_BOOKING_ID,
          ),
      ).toBe(true);
      const independentlyReadBack = tripLedger.ledger.calls
        .slice(mutationIndex + 1)
        .some(
          (call) =>
            call.name === 'get_trip_record' && call.arguments.bookingId === TARGET_BOOKING_ID,
        );
      if (!independentlyReadBack) {
        throw new Error(`mcp_exact_chat_readback_missing: ${diagnostic()}`);
      }

      const remoteJobs = Object.values(useRemoteStore.getState().jobs);
      expect(remoteJobs.filter((job) => job.status === 'failed')).toHaveLength(0);
      expect(remoteJobs.filter((job) => job.status === 'completed').length).toBeGreaterThanOrEqual(
        3,
      );
    } finally {
      useApprovalStore.setState({
        requests: approvalSnapshot.requests,
        policy: approvalSnapshot.policy,
        allowlist: approvalSnapshot.allowlist,
        analytics: approvalSnapshot.analytics,
      });
      mcpManager.disconnectServer(mcpConfig.id);
      await tripLedger.close();
    }
  });
});
