// ---------------------------------------------------------------------------
// Tests — native handoffs and captures settle through the durable effect journal
// ---------------------------------------------------------------------------
// A code-owned native tool that returned "opened" or "captured" reported its effect;
// the journal settles it so the run's later effects are not held for reconciliation.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/events/bus', () => ({ emitAgentEvent: jest.fn() }));
jest.mock('../../src/services/security/audit', () => ({ logToolCall: jest.fn() }));
jest.mock('../../src/services/executionJournal/externalToolDurabilityLifecycle', () => {
  const actual = jest.requireActual(
    '../../src/services/executionJournal/externalToolDurabilityLifecycle',
  );
  return {
    ...actual,
    observeExternalToolResultDurability: jest.fn().mockResolvedValue({ kind: 'not_external' }),
  };
});
jest.mock('../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn(),
  requestToolApproval: jest.fn(),
}));
jest.mock('../../src/engine/tools/toolDispatchRouter', () => ({ executeToolInner: jest.fn() }));

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import { executeToolInner } from '../../src/engine/tools/toolDispatchRouter';
import { useToolPermissionsStore } from '../../src/services/security/permissions';
import type { ToolDefinition } from '../../src/types/tool';
import {
  MAPS_OPEN_TOOL,
  OPEN_URL_TOOL,
} from '../../src/engine/tools/native/communication/definitions';
import { executeNativeTool } from '../../src/engine/tools/native/executor';
import {
  CAMERA_CLIP_TOOL,
  SCREEN_RECORD_TOOL,
} from '../../src/engine/tools/native/media/definitions';
import { REMINDER_TOOL } from '../../src/engine/tools/native/reminders/definitions';
import { completedToolOutcome } from '../../src/types/toolRuntimeOutcome';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};
const mockedExecuteToolInner = jest.mocked(executeToolInner);

function nativeLifecycle(definition: ToolDefinition, args: object): ToolExecutionLifecycleParams {
  return {
    tc: {
      id: `tool-call-${definition.name}`,
      name: definition.name,
      arguments: JSON.stringify(args),
    },
    iteration: 1,
    batchIndex: 0,
    conversationId: 'conversation-1',
    memoryConversationId: 'memory-conversation-1',
    provider: {
      id: 'provider-1',
      name: 'Provider',
      kind: 'remote',
      baseUrl: 'https://provider.invalid',
      apiKey: 'secret',
      model: 'model-1',
      enabled: true,
    },
    model: 'model-1',
    availableToolNames: new Set([definition.name]),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
      hasWebSearchProvider: false,
      hasSshTargets: false,
      hasBrowserProviders: false,
      hasExpoAccounts: false,
      hasConfiguredSecret: () => false,
    },
    toolCallHistory: [],
    groundedRequestScopedTools: [definition],
    trackedAsyncOperations: new Map(),
    callbacks: { onToolCallStart: jest.fn(), onToolCallComplete: jest.fn() },
    usePerformanceMetrics: false,
    agentRunId: 'agent-run-1',
    executionRunId: 'execution-run-1',
    idPrefixes: {
      blocked: 'blocked',
      filtered: 'filtered',
      workflow: 'workflow',
      cancelled: 'cancelled',
      success: 'tool',
      error: 'error',
    },
  };
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
  mockedExecuteToolInner.mockReset();
  useToolPermissionsStore.getState().reset();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('native effect settlement', () => {
  it('settles native handoffs and captures so the run’s later effects still dispatch', async () => {
    const outcomes: Record<string, string> = {
      maps_open: JSON.stringify({ status: 'opened', code: 'maps_opened' }),
      screen_record: JSON.stringify({ status: 'captured', format: 'png' }),
      camera_clip: JSON.stringify({ status: 'recorded', durationSeconds: 3 }),
    };
    mockedExecuteToolInner.mockImplementation(async (name) =>
      completedToolOutcome(outcomes[name]!),
    );

    const toolMessages = [];
    for (const [definition, args] of [
      [MAPS_OPEN_TOOL, { query: 'E2E Station' }],
      [SCREEN_RECORD_TOOL, { format: 'png' }],
      [CAMERA_CLIP_TOOL, { durationSeconds: 3 }],
    ] as const) {
      const result = await executeToolCallLifecycle(nativeLifecycle(definition, args));
      if (!('toolMessage' in result)) throw new Error(`${definition.name} was deferred`);
      toolMessages.push(result.toolMessage);
    }

    expect(mockedExecuteToolInner).toHaveBeenCalledTimes(3);
    expect(toolMessages.map((message) => message.content)).toEqual([
      outcomes.maps_open,
      outcomes.screen_record,
      outcomes.camera_clip,
    ]);
    expect(toolMessages.every((message) => message.isError !== true)).toBe(true);
    expect(
      getExecutionJournalDb()
        .getAllSync<{ status: string }>('SELECT status FROM execution_effects ORDER BY id')
        .map((row) => row.status),
    ).toEqual(['returned', 'returned', 'returned']);
  });

  // Traced on the GLM 5.3 Flash suite (e7f3-r1, bench-androidworld-permission-denial): asked to
  // handle denied location access, the model opened `app-settings:`, which open_url refuses
  // before touching the device. The refusal was reported as a failure of unknown effect, the
  // journal required reconciliation, and the run's maps_open was blocked.
  it('settles a refused request as not applied, so the run’s later effects still dispatch', async () => {
    mockedExecuteToolInner.mockImplementation(async (name, argsString) =>
      name === 'open_url'
        ? executeNativeTool(name, argsString)
        : completedToolOutcome(JSON.stringify({ status: 'opened', code: 'maps_opened' })),
    );

    const results = [];
    for (const [definition, args] of [
      [OPEN_URL_TOOL, { url: 'app-settings:' }],
      [MAPS_OPEN_TOOL, { query: 'E2E Station' }],
    ] as const) {
      const result = await executeToolCallLifecycle(nativeLifecycle(definition, args));
      if (!('toolMessage' in result)) throw new Error(`${definition.name} was deferred`);
      results.push(result);
    }

    expect(JSON.parse(results[0]!.toolMessage.content)).toMatchObject({
      status: 'invalid_request',
      code: 'disallowed_url_scheme',
    });
    expect(results.map((result) => result.effectReconciliationRequired)).toEqual([
      undefined,
      undefined,
    ]);
    expect(mockedExecuteToolInner).toHaveBeenCalledTimes(2);
    expect(JSON.parse(results[1]!.toolMessage.content)).toEqual({
      status: 'opened',
      code: 'maps_opened',
    });
  });

  // Traced on the GLM 5.3 Flash suite (bench-androidworld-clipboard-share-notify, f6687f45):
  // a reminder cancel reported its own effect kind, the journal claim for the reminder tool
  // expected the tool's, and the receipt was rejected; the run stopped for reconciliation.
  it('settles a reminder cancel as the reminder schedule change it is', async () => {
    const outcomes = [
      JSON.stringify({ status: 'reminder_created', reminder: { id: 'r1', title: 'Stretch' } }),
      JSON.stringify({ status: 'reminder_cancelled', id: 'r1' }),
    ];
    mockedExecuteToolInner.mockImplementation(async () => completedToolOutcome(outcomes.shift()!));

    const results = [];
    for (const [id, args] of [
      [
        'call-create',
        { action: 'create', title: 'Stretch', when: { kind: 'once', delaySeconds: 30 } },
      ],
      ['call-cancel', { action: 'cancel', id: 'r1' }],
    ] as const) {
      const lifecycle = nativeLifecycle(REMINDER_TOOL, args);
      const result = await executeToolCallLifecycle({
        ...lifecycle,
        tc: { ...lifecycle.tc, id },
      });
      if (!('toolMessage' in result)) throw new Error(`${id} was deferred`);
      results.push(result);
    }

    expect(results.map((result) => result.toolMessage.isError === true)).toEqual([false, false]);
    expect(results.map((result) => result.effectReconciliationRequired)).toEqual([
      undefined,
      undefined,
    ]);
    expect(JSON.parse(results[1]!.toolMessage.content)).toEqual({
      status: 'reminder_cancelled',
      id: 'r1',
    });
  });
});
