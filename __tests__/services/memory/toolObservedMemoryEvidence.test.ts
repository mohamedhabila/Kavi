import { TOOL_DEFINITIONS } from '../../../src/engine/tools/definitions';
import {
  bindCurrentTurnToolObservedMemoryEvidence,
  collectCurrentRunCompletedToolResults,
  type CurrentRunCompletedToolResult,
  deriveExactToolObservedMemoryEvidenceSpan,
  resolveToolObservedMemoryEvidenceBinding,
  TOOL_OBSERVED_MEMORY_EVIDENCE_MAX_SPAN_CODE_POINTS,
} from '../../../src/services/memory/toolObservedMemoryEvidence';
import type { Message, ToolCall } from '../../../src/types/message';
import type { ToolDefinition } from '../../../src/types/tool';
import { sha256HexUtf8 } from '../../../src/utils/sha256';

const EXECUTION_RUN_ID = 'execution-run-current';
const CURRENT_USER_MESSAGE_ID = 'message-user-current';

function requireStaticTool(name: string): ToolDefinition {
  const definition = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing static tool fixture: ${name}`);
  return definition;
}

const READ_FILE = requireStaticTool('read_file');
const WRITE_FILE = requireStaticTool('write_file');
const MEMORY_RECALL = requireStaticTool('memory_recall');

type TurnFixtureOptions = Readonly<{
  toolName?: string;
  planToolName?: string;
  argumentsText?: string;
  result?: string;
  includePlan?: boolean;
  planArgumentsText?: string;
  planStatus?: ToolCall['status'];
  resultStatus?: ToolCall['status'];
  resultError?: string;
  resultValue?: string;
  messageIsError?: boolean;
  messageToolCallId?: string;
}>;

function buildTurnFixture(options: TurnFixtureOptions = {}): Message[] {
  const toolName = options.toolName ?? 'read_file';
  const argumentsText = options.argumentsText ?? '{"path":"profile.json"}';
  const result = options.result ?? '{"displayName":"نور","timezone":"Asia/Amman"}';
  const toolCallId = 'tool-call-current';
  const messages: Message[] = [
    {
      id: CURRENT_USER_MESSAGE_ID,
      role: 'user',
      content: 'Inspect the profile.',
      timestamp: 1,
    },
  ];
  if (options.includePlan !== false) {
    messages.push({
      id: 'message-assistant-plan',
      role: 'assistant',
      content: '',
      timestamp: 2,
      toolCalls: [
        {
          id: toolCallId,
          name: options.planToolName ?? toolName,
          arguments: options.planArgumentsText ?? argumentsText,
          status: options.planStatus ?? 'pending',
        },
      ],
    });
  }
  const terminalCall: ToolCall = {
    id: toolCallId,
    name: toolName,
    arguments: argumentsText,
    status: options.resultStatus ?? 'completed',
    result: options.resultValue === undefined ? result : options.resultValue,
    ...(options.resultError === undefined ? {} : { error: options.resultError }),
  };
  messages.push({
    id: 'message-tool-result',
    role: 'tool',
    content: result,
    timestamp: 3,
    toolCallId: options.messageToolCallId ?? toolCallId,
    toolCalls: [terminalCall],
    ...(options.messageIsError === undefined ? {} : { isError: options.messageIsError }),
  });
  return messages;
}

function completionFor(
  workingMessages: ReadonlyArray<Message>,
  patch: Partial<CurrentRunCompletedToolResult> = {},
): CurrentRunCompletedToolResult {
  let message: Message | undefined;
  for (let index = workingMessages.length - 1; index >= 0; index -= 1) {
    if (workingMessages[index]?.role === 'tool') {
      message = workingMessages[index];
      break;
    }
  }
  const call = message?.toolCalls?.[0];
  if (!message || !call) throw new Error('Missing terminal tool fixture');
  return {
    executionRunId: EXECUTION_RUN_ID,
    sourceMessageId: message.id,
    sourceToolCallId: call.id,
    sourceToolName: call.name,
    argumentsSha256: sha256HexUtf8(call.arguments),
    visibleResultSha256: sha256HexUtf8(message.content),
    visibleResultFidelity: 'complete',
    ...patch,
  };
}

function bind(
  workingMessages: ReadonlyArray<Message>,
  executedToolDefinitions: ReadonlyArray<ToolDefinition> = [READ_FILE],
  currentUserMessageId = CURRENT_USER_MESSAGE_ID,
  currentRunCompletedToolResults: ReadonlyArray<CurrentRunCompletedToolResult> = [
    completionFor(workingMessages),
  ],
) {
  return bindCurrentTurnToolObservedMemoryEvidence({
    executionRunId: EXECUTION_RUN_ID,
    currentUserMessageId,
    workingMessages,
    executedToolDefinitions,
    currentRunCompletedToolResults,
  });
}

describe('current-turn tool-observed memory evidence binding', () => {
  it('collects exact completion membership from lifecycle history and working messages', () => {
    const messages = buildTurnFixture();
    const completed = collectCurrentRunCompletedToolResults({
      executionRunId: EXECUTION_RUN_ID,
      workingMessages: messages,
      toolCallHistory: [
        {
          id: 'tool-call-current',
          name: 'read_file',
          arguments: '{"path":"profile.json"}',
          status: 'completed',
          result: '{"displayName":"نور","timezone":"Asia/Amman"}',
        },
      ],
    });

    expect(completed).toEqual([
      {
        executionRunId: EXECUTION_RUN_ID,
        sourceMessageId: 'message-tool-result',
        sourceToolCallId: 'tool-call-current',
        sourceToolName: 'read_file',
        argumentsSha256: sha256HexUtf8('{"path":"profile.json"}'),
        visibleResultSha256: sha256HexUtf8(
          '{"displayName":"نور","timezone":"Asia/Amman"}',
        ),
        visibleResultFidelity: 'complete',
      },
    ]);
    expect(Object.isFrozen(completed)).toBe(true);
    expect(Object.isFrozen(completed[0])).toBe(true);
  });

  it('does not reconstruct completion authority from mismatched or duplicate history', () => {
    const messages = buildTurnFixture();
    const exact = {
      id: 'tool-call-current',
      name: 'read_file',
      arguments: '{"path":"profile.json"}',
      status: 'completed',
      result: '{"displayName":"نور","timezone":"Asia/Amman"}',
    };

    expect(
      collectCurrentRunCompletedToolResults({
        executionRunId: EXECUTION_RUN_ID,
        workingMessages: messages,
        toolCallHistory: [{ ...exact, result: 'different' }],
      }),
    ).toEqual([]);
    expect(
      collectCurrentRunCompletedToolResults({
        executionRunId: EXECUTION_RUN_ID,
        workingMessages: messages,
        toolCallHistory: [exact, exact],
      }),
    ).toEqual([]);
  });

  it('mints an opaque frozen capability bound to exact execution evidence', () => {
    const messages = buildTurnFixture();
    const capabilities = bind(messages);

    expect(capabilities).toHaveLength(1);
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(Object.isFrozen(capabilities[0])).toBe(true);
    expect(Object.keys(capabilities[0]!)).toEqual(['kind']);

    const binding = resolveToolObservedMemoryEvidenceBinding(capabilities[0]);
    expect(binding).toEqual({
      version: 1,
      executionRunId: EXECUTION_RUN_ID,
      sourceMessageId: 'message-tool-result',
      sourceToolCallId: 'tool-call-current',
      sourceToolName: 'read_file',
      argumentsText: '{"path":"profile.json"}',
      visibleResult: '{"displayName":"نور","timezone":"Asia/Amman"}',
      argumentsSha256: sha256HexUtf8('{"path":"profile.json"}'),
      visibleResultSha256: sha256HexUtf8(
        '{"displayName":"نور","timezone":"Asia/Amman"}',
      ),
      canonicalStaticContractDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it('accepts the code-owned prompt-cache placement copy used by the turn surface', () => {
    const surfacedReadFile: ToolDefinition = {
      ...READ_FILE,
      promptCache: { placement: 'stable_prefix' },
    };

    expect(bind(buildTurnFixture(), [surfacedReadFile])).toHaveLength(1);
  });

  it('pairs a structurally canonicalized provider alias with the executed builtin', () => {
    expect(bind(buildTurnFixture({ planToolName: 'provider:read_file' }))).toHaveLength(1);
  });

  it('rejects a JSON-identical dynamic declaration instead of trusting its claims', () => {
    const dynamicClone = JSON.parse(JSON.stringify(READ_FILE)) as ToolDefinition;
    const dynamicPromptClone = {
      ...dynamicClone,
      promptCache: { placement: 'stable_prefix' as const },
    };

    expect(bind(buildTurnFixture(), [dynamicClone])).toHaveLength(0);
    expect(bind(buildTurnFixture(), [dynamicPromptClone])).toHaveLength(0);
    expect(bind(buildTurnFixture(), [{ ...READ_FILE }])).toHaveLength(0);
  });

  it.each([
    ['effectful static tool', WRITE_FILE],
    ['memory static tool', MEMORY_RECALL],
  ])('rejects an ineligible %s by canonical contract metadata', (_label, definition) => {
    expect(
      bind(buildTurnFixture({ toolName: definition.name }), [definition]),
    ).toHaveLength(0);
  });

  it('rejects a dynamic tool that self-declares read-only verification authority', () => {
    const dynamicTool: ToolDefinition = {
      name: 'mcp__profile__read',
      description: 'Runtime declaration',
      input_schema: { type: 'object', properties: {} },
      contract: {
        category: 'profile',
        capabilities: ['read', 'verify'],
        resourceKinds: ['device'],
        sideEffects: ['none'],
        providesEvidence: ['verification'],
      },
    };

    expect(
      bind(buildTurnFixture({ toolName: dynamicTool.name }), [dynamicTool]),
    ).toHaveLength(0);
  });

  it.each([
    [
      'failed result',
      {
        resultStatus: 'failed' as const,
        resultError: 'unavailable',
        resultValue: '',
        messageIsError: true,
      },
    ],
    ['result mismatch', { resultValue: 'different' }],
    ['placeholder', { result: '[compacted: historical read_file output removed.]' }],
    [
      'spill envelope',
      {
        result: JSON.stringify({
          status: 'spilled',
          path: '.kavi/spill/read_file-1.txt',
          byteLength: 9_000,
          preview: 'preview',
          notice: 'stored',
        }),
      },
    ],
    ['oversized visible result', { result: '界'.repeat(2_731) }],
    ['missing assistant plan', { includePlan: false }],
    ['failed assistant plan', { planStatus: 'failed' as const }],
    ['mismatched planned arguments', { planArgumentsText: '{"path":"other.json"}' }],
    ['mismatched terminal identity', { messageToolCallId: 'tool-call-other' }],
  ])('rejects %s evidence', (_label, options) => {
    expect(bind(buildTurnFixture(options))).toHaveLength(0);
  });

  it('rejects duplicate tool-call and source-message identities', () => {
    const duplicateTerminal = buildTurnFixture();
    duplicateTerminal.push({
      ...duplicateTerminal[2]!,
      id: 'message-tool-result-second',
    });
    expect(bind(duplicateTerminal)).toHaveLength(0);

    const duplicateMessageId = buildTurnFixture();
    duplicateMessageId.push({
      id: 'message-tool-result',
      role: 'assistant',
      content: 'duplicate id',
      timestamp: 4,
    });
    expect(bind(duplicateMessageId)).toHaveLength(0);
  });

  it('ignores prior-turn evidence and requires the supplied user to be the latest user', () => {
    const priorTurn = buildTurnFixture();
    priorTurn.push({
      id: 'message-user-latest',
      role: 'user',
      content: 'A new turn.',
      timestamp: 4,
    });

    expect(bind(priorTurn)).toHaveLength(0);
    expect(bind(priorTurn, [READ_FILE], 'message-user-latest')).toHaveLength(0);
  });

  it('requires current-run completion membership after retrying the same user turn', () => {
    const messages = buildTurnFixture({ result: 'prior-run-value' });
    messages[1]!.id = 'message-assistant-prior-run';
    messages[1]!.toolCalls![0]!.id = 'tool-call-prior-run';
    messages[2]!.id = 'message-tool-prior-run';
    messages[2]!.toolCallId = 'tool-call-prior-run';
    messages[2]!.toolCalls![0]!.id = 'tool-call-prior-run';

    const retriedRun = buildTurnFixture({ result: 'current-run-value' }).slice(1);
    messages.push(...retriedRun);

    const capabilities = bind(messages);
    expect(capabilities).toHaveLength(1);
    expect(resolveToolObservedMemoryEvidenceBinding(capabilities[0])).toEqual(
      expect.objectContaining({
        executionRunId: EXECUTION_RUN_ID,
        sourceMessageId: 'message-tool-result',
        sourceToolCallId: 'tool-call-current',
        visibleResult: 'current-run-value',
      }),
    );
  });

  it('binds multiple independently completed eligible results in message order', () => {
    const messages = buildTurnFixture({ result: 'first-result' });
    messages[1]!.id = 'message-assistant-first';
    messages[1]!.toolCalls![0]!.id = 'tool-call-first';
    messages[2]!.id = 'message-tool-first';
    messages[2]!.toolCallId = 'tool-call-first';
    messages[2]!.toolCalls![0]!.id = 'tool-call-first';
    messages.push(...buildTurnFixture({ result: 'second-result' }).slice(1));

    const capabilities = bind(messages, [READ_FILE], CURRENT_USER_MESSAGE_ID, [
      completionFor([messages[2]!]),
      completionFor([messages[4]!]),
    ]);

    expect(
      capabilities.map(
        (capability) => resolveToolObservedMemoryEvidenceBinding(capability)?.visibleResult,
      ),
    ).toEqual(['first-result', 'second-result']);
  });

  it('fails closed without an exact, unambiguous current-run completion set', () => {
    const messages = buildTurnFixture();
    expect(bind(messages, [READ_FILE], CURRENT_USER_MESSAGE_ID, [])).toHaveLength(0);
    expect(
      bind(messages, [READ_FILE], CURRENT_USER_MESSAGE_ID, [
        completionFor(messages, { executionRunId: 'execution-run-prior' }),
      ]),
    ).toHaveLength(0);
    const exactCompletion = completionFor(messages);
    expect(
      bind(messages, [READ_FILE], CURRENT_USER_MESSAGE_ID, [
        exactCompletion,
        exactCompletion,
      ]),
    ).toHaveLength(0);
  });

  it.each(['spilled', 'transformed', 'compacted'] as const)(
    'rejects structurally non-complete %s output without text marker matching',
    (visibleResultFidelity) => {
      const messages = buildTurnFixture({ result: 'subject [omitted material] value' });
      expect(
        bind(messages, [READ_FILE], CURRENT_USER_MESSAGE_ID, [
          completionFor(messages, { visibleResultFidelity }),
        ]),
      ).toHaveLength(0);
    },
  );

  it('rejects malformed provenance ids and sibling definitions with the same name', () => {
    const invalidResultId = buildTurnFixture();
    invalidResultId[2]!.id = 'message tool result';
    expect(bind(invalidResultId)).toHaveLength(0);

    const promptCopy = { ...READ_FILE, promptCache: { placement: 'dynamic_suffix' as const } };
    expect(bind(buildTurnFixture(), [READ_FILE, promptCopy])).toHaveLength(0);

    const duplicateUserId = buildTurnFixture();
    duplicateUserId.push({
      id: CURRENT_USER_MESSAGE_ID,
      role: 'assistant',
      content: 'duplicate id',
      timestamp: 4,
    });
    expect(bind(duplicateUserId)).toHaveLength(0);

    expect(
      bindCurrentTurnToolObservedMemoryEvidence({
        executionRunId: 'invalid run',
        currentUserMessageId: CURRENT_USER_MESSAGE_ID,
        workingMessages: buildTurnFixture(),
        executedToolDefinitions: [READ_FILE],
        currentRunCompletedToolResults: [],
      }),
    ).toHaveLength(0);
  });
});

describe('exact tool-observed evidence span derivation', () => {
  function capabilityFor(result: string) {
    const capabilities = bind(buildTurnFixture({ result }));
    if (!capabilities[0]) throw new Error('Expected eligible evidence fixture');
    return capabilities[0];
  }

  it('selects the nearest exact multilingual subject/value cover without normalization', () => {
    const source = '対象: 古い値。対象: 値🌍。 Café résumé قيمة ٤٢';
    const capability = capabilityFor(source);
    const result = deriveExactToolObservedMemoryEvidenceSpan(capability, '対象', '値🌍');

    const expectedSubjectStart = source.lastIndexOf('対象');
    const expectedValueStart = source.indexOf('値🌍');
    expect(result).toEqual({
      ok: true,
      evidenceSpan: '対象: 値🌍',
      evidenceSpanStart: expectedSubjectStart,
      evidenceSpanEnd: expectedValueStart + '値🌍'.length,
      subjectStart: expectedSubjectStart,
      subjectEnd: expectedSubjectStart + '対象'.length,
      valueStart: expectedValueStart,
      valueEnd: expectedValueStart + '値🌍'.length,
    });
    expect(deriveExactToolObservedMemoryEvidenceSpan(capability, 'café', 'résumé')).toEqual({
      ok: false,
      reason: 'not_grounded',
    });
    expect(deriveExactToolObservedMemoryEvidenceSpan(capability, 'قيمة', '٤٢')).toEqual(
      expect.objectContaining({ ok: true, evidenceSpan: 'قيمة ٤٢' }),
    );
  });

  it('rejects forged capabilities and empty or absent claim parts', () => {
    const capability = capabilityFor('subject=value');

    expect(
      deriveExactToolObservedMemoryEvidenceSpan(
        { kind: 'tool_observed_memory_evidence' },
        'subject',
        'value',
      ),
    ).toEqual({ ok: false, reason: 'invalid_capability' });
    expect(deriveExactToolObservedMemoryEvidenceSpan(capability, '', 'value')).toEqual({
      ok: false,
      reason: 'invalid_claim_part',
    });
    expect(deriveExactToolObservedMemoryEvidenceSpan(capability, 'missing', 'value')).toEqual({
      ok: false,
      reason: 'not_grounded',
    });
  });

  it('bounds spans by Unicode code points while preserving exact UTF-16 offsets', () => {
    const acceptedSource = `S${'🌍'.repeat(
      TOOL_OBSERVED_MEMORY_EVIDENCE_MAX_SPAN_CODE_POINTS - 2,
    )}V`;
    const rejectedSource = `S${'🌍'.repeat(
      TOOL_OBSERVED_MEMORY_EVIDENCE_MAX_SPAN_CODE_POINTS - 1,
    )}V`;

    expect(
      deriveExactToolObservedMemoryEvidenceSpan(
        capabilityFor(acceptedSource),
        'S',
        'V',
      ),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        evidenceSpan: acceptedSource,
        evidenceSpanEnd: acceptedSource.length,
      }),
    );
    expect(
      deriveExactToolObservedMemoryEvidenceSpan(
        capabilityFor(rejectedSource),
        'S',
        'V',
      ),
    ).toEqual({ ok: false, reason: 'span_too_large' });
  });
});
