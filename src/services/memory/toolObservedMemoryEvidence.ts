import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import { resolveToolEffectPolicy } from '../../engine/durability/toolEffectPolicy';
import {
  normalizeToolName,
  resolveRegisteredToolName,
} from '../../engine/tools/toolNameNormalization';
import type { Message, ToolCall } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { sha256HexUtf8 } from '../../utils/sha256';
import { isToolResultPlaceholder } from '../../utils/toolResultSummary';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';

const CAPABILITY_KIND = 'tool_observed_memory_evidence' as const;
const BINDING_VERSION = 1 as const;
const MAX_VISIBLE_RESULT_UTF8_BYTES = 8 * 1024;

export const TOOL_OBSERVED_MEMORY_EVIDENCE_MAX_SPAN_CODE_POINTS = 600;

declare const toolObservedMemoryEvidenceCapabilityBrand: unique symbol;

/**
 * An in-process authority minted only from code-owned working-message state.
 * Its provenance is deliberately absent from the enumerable object surface.
 */
export type ToolObservedMemoryEvidenceCapability = Readonly<{
  kind: typeof CAPABILITY_KIND;
  [toolObservedMemoryEvidenceCapabilityBrand]: true;
}>;

export type ToolObservedMemoryEvidenceBinding = Readonly<{
  version: typeof BINDING_VERSION;
  executionRunId: string;
  sourceMessageId: string;
  sourceToolCallId: string;
  sourceToolName: string;
  argumentsText: string;
  visibleResult: string;
  argumentsSha256: string;
  visibleResultSha256: string;
  canonicalStaticContractDigest: string;
}>;

type ExactEvidenceSpan = Readonly<{
  ok: true;
  evidenceSpan: string;
  evidenceSpanStart: number;
  evidenceSpanEnd: number;
  subjectStart: number;
  subjectEnd: number;
  valueStart: number;
  valueEnd: number;
}>;

export type ToolObservedMemoryEvidenceSpanResult =
  | ExactEvidenceSpan
  | Readonly<{
      ok: false;
      reason: 'invalid_capability' | 'invalid_claim_part' | 'not_grounded' | 'span_too_large';
    }>;

/** Code-owned execution-graph observation; never derive this from model input. */
export type CurrentRunCompletedToolResult = Readonly<{
  executionRunId: string;
  sourceMessageId: string;
  sourceToolCallId: string;
  sourceToolName: string;
  argumentsSha256: string;
  visibleResultSha256: string;
  visibleResultFidelity: 'complete' | 'spilled' | 'transformed' | 'compacted';
}>;

export type BindCurrentTurnToolObservedMemoryEvidenceInput = Readonly<{
  executionRunId: string;
  currentUserMessageId: string;
  workingMessages: ReadonlyArray<Message>;
  /** The exact code-owned turn surface used for execution, before provider serialization. */
  executedToolDefinitions: ReadonlyArray<ToolDefinition>;
  /**
   * Run-owned completion identities captured by the execution graph. Message
   * order alone cannot distinguish a retry of the same user turn.
   */
  currentRunCompletedToolResults: ReadonlyArray<CurrentRunCompletedToolResult>;
}>;

type CanonicalToolRegistryEntry = Readonly<{
  definition: ToolDefinition;
  occurrences: number;
}>;

const CANONICAL_STATIC_TOOLS = new Map<string, CanonicalToolRegistryEntry>();
for (const definition of TOOL_DEFINITIONS) {
  const name = normalizeToolName(definition.name);
  const current = CANONICAL_STATIC_TOOLS.get(name);
  CANONICAL_STATIC_TOOLS.set(name, {
    definition: current?.definition ?? definition,
    occurrences: (current?.occurrences ?? 0) + 1,
  });
}

const CAPABILITY_BINDINGS = new WeakMap<object, ToolObservedMemoryEvidenceBinding>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isPlainRecord(value)) {
    const fields = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${fields.join(',')}}`;
  }
  throw new TypeError('Static tool contract contains a non-canonical value.');
}

function canonicalStaticContractDigest(definition: ToolDefinition): string {
  const material = canonicalJson({
    domain: 'kavi.tool-observed-memory.static-contract',
    version: BINDING_VERSION,
    name: definition.name,
    description: definition.description,
    inputSchema: definition.input_schema,
    strict: definition.strict ?? 'auto',
    contract: definition.contract ?? null,
    executionPolicy: resolveToolEffectPolicy(definition.name),
  });
  return `sha256:${sha256HexUtf8(material)}`;
}

function hasOnlyCanonicalOwnProperties(
  selected: ToolDefinition,
  canonical: ToolDefinition,
): boolean {
  const selectedKeys = Reflect.ownKeys(selected).filter((key) => key !== 'promptCache');
  const canonicalKeys = Reflect.ownKeys(canonical).filter((key) => key !== 'promptCache');
  if (selectedKeys.length !== canonicalKeys.length) return false;
  return canonicalKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(selected, key) &&
      Reflect.get(selected, key) === Reflect.get(canonical, key),
  );
}

function hasCanonicalPromptCacheMetadata(definition: ToolDefinition): boolean {
  if (definition.promptCache === undefined) return true;
  if (!isPlainRecord(definition.promptCache)) return false;
  const keys = Reflect.ownKeys(definition.promptCache);
  return (
    keys.every((key) => key === 'placement') &&
    (definition.promptCache.placement === undefined ||
      definition.promptCache.placement === 'stable_prefix' ||
      definition.promptCache.placement === 'dynamic_suffix')
  );
}

/**
 * Runtime extensions can reproduce static JSON but cannot inherit the exact
 * registry-owned schema and contract objects used by the app's turn surface.
 * Prompt-cache placement is the only supported shallow-copy transformation.
 */
function isExactCodeOwnedTurnDefinition(
  selected: ToolDefinition,
  canonical: ToolDefinition,
): boolean {
  if (selected === canonical) return hasCanonicalPromptCacheMetadata(selected);
  return (
    Object.prototype.hasOwnProperty.call(selected, 'promptCache') &&
    selected.promptCache?.placement !== undefined &&
    hasOnlyCanonicalOwnProperties(selected, canonical) &&
    hasCanonicalPromptCacheMetadata(selected)
  );
}

function resolveUniqueExecutedCanonicalTool(
  definitions: ReadonlyArray<ToolDefinition>,
  toolName: string,
): ToolDefinition | undefined {
  const canonicalEntry = CANONICAL_STATIC_TOOLS.get(toolName);
  if (!canonicalEntry || canonicalEntry.occurrences !== 1) return undefined;

  let selected: ToolDefinition | undefined;
  for (const definition of definitions) {
    if (!definition || typeof definition.name !== 'string') return undefined;
    if (normalizeToolName(definition.name) !== toolName) continue;
    if (selected) return undefined;
    selected = definition;
  }
  if (!selected || !isExactCodeOwnedTurnDefinition(selected, canonicalEntry.definition)) {
    return undefined;
  }
  return canonicalEntry.definition;
}

function isEligibleStaticEvidenceTool(definition: ToolDefinition): boolean {
  const contract = definition.contract;
  if (!contract) return false;
  const capabilities = contract.capabilities ?? [];
  const resourceKinds = contract.resourceKinds ?? [];
  const executionPolicy = resolveToolEffectPolicy(definition.name);
  return (
    contract.sideEffects?.length === 1 &&
    contract.sideEffects[0] === 'none' &&
    (capabilities.includes('read') || capabilities.includes('verify')) &&
    contract.providesEvidence?.includes('verification') === true &&
    contract.category !== 'memory' &&
    !resourceKinds.includes('memory') &&
    executionPolicy.source === 'builtin' &&
    executionPolicy.effects.length === 1 &&
    executionPolicy.effects[0] === 'none' &&
    executionPolicy.idempotency === 'effect_free' &&
    executionPolicy.retryPolicy === 'replay_safe'
  );
}

function utf8ByteLengthAtMost(value: string, maximum: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first <= 0x7f) bytes += 1;
    else if (first <= 0x7ff) bytes += 2;
    else if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
    if (bytes > maximum) return false;
  }
  return true;
}

function isCanonicalSpillEnvelope(content: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  if (!isPlainRecord(parsed)) return false;
  const keys = Object.keys(parsed).sort();
  return (
    keys.length === 5 &&
    keys[0] === 'byteLength' &&
    keys[1] === 'notice' &&
    keys[2] === 'path' &&
    keys[3] === 'preview' &&
    keys[4] === 'status' &&
    parsed.status === 'spilled' &&
    typeof parsed.path === 'string' &&
    Number.isSafeInteger(parsed.byteLength) &&
    (parsed.byteLength as number) > 0 &&
    typeof parsed.preview === 'string' &&
    typeof parsed.notice === 'string'
  );
}

function isSuccessfulVisibleToolResult(message: Message, toolCall: ToolCall): boolean {
  return (
    message.role === 'tool' &&
    typeof message.content === 'string' &&
    (message.isError === undefined || message.isError === false) &&
    message.toolCallId === toolCall.id &&
    message.toolCalls?.length === 1 &&
    message.toolCalls[0] === toolCall &&
    toolCall.status === 'completed' &&
    toolCall.failureKind === undefined &&
    toolCall.error === undefined &&
    typeof toolCall.result === 'string' &&
    toolCall.result === message.content &&
    message.content.length > 0 &&
    !isToolResultPlaceholder(message.content) &&
    !isCanonicalSpillEnvelope(message.content) &&
    utf8ByteLengthAtMost(message.content, MAX_VISIBLE_RESULT_UTF8_BYTES)
  );
}

function indexCurrentRunCompletions(
  executionRunId: string,
  completions: ReadonlyArray<CurrentRunCompletedToolResult>,
): ReadonlyMap<string, CurrentRunCompletedToolResult> | undefined {
  const toolCallIds = new Set<string>();
  const completionByMessageId = new Map<string, CurrentRunCompletedToolResult>();
  for (const completion of completions) {
    if (
      !completion ||
      completion.executionRunId !== executionRunId ||
      !isExactMemoryProvenanceId(completion.sourceMessageId) ||
      !isExactMemoryProvenanceId(completion.sourceToolCallId) ||
      typeof completion.sourceToolName !== 'string' ||
      normalizeToolName(completion.sourceToolName) !== completion.sourceToolName ||
      !/^[a-f0-9]{64}$/u.test(completion.argumentsSha256) ||
      !/^[a-f0-9]{64}$/u.test(completion.visibleResultSha256) ||
      !['complete', 'spilled', 'transformed', 'compacted'].includes(
        completion.visibleResultFidelity,
      ) ||
      completionByMessageId.has(completion.sourceMessageId) ||
      toolCallIds.has(completion.sourceToolCallId)
    ) {
      return undefined;
    }
    completionByMessageId.set(completion.sourceMessageId, completion);
    toolCallIds.add(completion.sourceToolCallId);
  }
  return completionByMessageId;
}

function matchesCompleteCurrentRunResult(
  completion: CurrentRunCompletedToolResult | undefined,
  toolCall: ToolCall,
  toolName: string,
  argumentsSha256: string,
  visibleResultSha256: string,
): boolean {
  return (
    completion?.sourceToolCallId === toolCall.id &&
    completion.sourceToolName === toolName &&
    completion.visibleResultFidelity === 'complete' &&
    completion.argumentsSha256 === argumentsSha256 &&
    completion.visibleResultSha256 === visibleResultSha256
  );
}

function findCurrentUserIndex(
  messages: ReadonlyArray<Message>,
  currentUserMessageId: string,
): number {
  let latestUserIndex = -1;
  let matchingUserIndex = -1;
  let idMatches = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === 'user') latestUserIndex = index;
    if (message.id === currentUserMessageId) {
      idMatches += 1;
      if (message.role === 'user') matchingUserIndex = index;
    }
  }
  return idMatches === 1 && matchingUserIndex === latestUserIndex ? latestUserIndex : -1;
}

function findUniquePlannedCall(
  messages: ReadonlyArray<Message>,
  currentUserIndex: number,
  resultIndex: number,
  resultCall: ToolCall,
): ToolCall | undefined {
  let planned: ToolCall | undefined;
  let totalMatches = 0;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]!;
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls ?? []) {
      if (call.id !== resultCall.id) continue;
      totalMatches += 1;
      if (
        messageIndex > currentUserIndex &&
        messageIndex < resultIndex &&
        (message.isError === undefined || message.isError === false) &&
        (call.status === 'pending' || call.status === 'running' || call.status === 'completed') &&
        call.failureKind === undefined &&
        call.error === undefined
      ) {
        planned = call;
      }
    }
  }
  return totalMatches === 1 && planned ? planned : undefined;
}

function isUniqueSourceIdentity(
  messages: ReadonlyArray<Message>,
  resultMessage: Message,
  toolCallId: string,
): boolean {
  let messageIdMatches = 0;
  let terminalMatches = 0;
  for (const message of messages) {
    if (message.id === resultMessage.id) messageIdMatches += 1;
    if (
      message.role === 'tool' &&
      (message.toolCallId === toolCallId ||
        message.toolCalls?.some((call) => call.id === toolCallId) === true)
    ) {
      terminalMatches += 1;
    }
  }
  return messageIdMatches === 1 && terminalMatches === 1;
}

function mintCapability(
  binding: ToolObservedMemoryEvidenceBinding,
): ToolObservedMemoryEvidenceCapability {
  const capability = Object.freeze({ kind: CAPABILITY_KIND }) as ToolObservedMemoryEvidenceCapability;
  CAPABILITY_BINDINGS.set(capability, binding);
  return capability;
}

/**
 * Derives ephemeral evidence authorities from successful tool calls in the
 * current turn. This function neither exposes an LLM tool nor persists data.
 */
export function bindCurrentTurnToolObservedMemoryEvidence(
  input: BindCurrentTurnToolObservedMemoryEvidenceInput,
): ReadonlyArray<ToolObservedMemoryEvidenceCapability> {
  if (!isExactMemoryProvenanceId(input.executionRunId)) {
    return Object.freeze([]);
  }
  const currentRunCompletions = indexCurrentRunCompletions(
    input.executionRunId,
    input.currentRunCompletedToolResults,
  );
  if (!isExactMemoryProvenanceId(input.currentUserMessageId) || !currentRunCompletions) {
    return Object.freeze([]);
  }
  const currentUserIndex = findCurrentUserIndex(
    input.workingMessages,
    input.currentUserMessageId,
  );
  if (currentUserIndex < 0) return Object.freeze([]);

  const capabilities: ToolObservedMemoryEvidenceCapability[] = [];
  for (let resultIndex = currentUserIndex + 1; resultIndex < input.workingMessages.length; resultIndex += 1) {
    const message = input.workingMessages[resultIndex]!;
    if (message.role !== 'tool' || message.toolCalls?.length !== 1) continue;
    const resultCall = message.toolCalls[0]!;
    if (typeof resultCall.name !== 'string' || typeof resultCall.arguments !== 'string') continue;
    const toolName = normalizeToolName(resultCall.name);
    if (
      !isExactMemoryProvenanceId(message.id) ||
      !isExactMemoryProvenanceId(resultCall.id) ||
      toolName !== resultCall.name ||
      !isSuccessfulVisibleToolResult(message, resultCall) ||
      !isUniqueSourceIdentity(input.workingMessages, message, resultCall.id)
    ) {
      continue;
    }
    const argumentsSha256 = sha256HexUtf8(resultCall.arguments);
    const visibleResultSha256 = sha256HexUtf8(message.content);
    if (
      !matchesCompleteCurrentRunResult(
        currentRunCompletions.get(message.id),
        resultCall,
        toolName,
        argumentsSha256,
        visibleResultSha256,
      )
    ) {
      continue;
    }

    const planned = findUniquePlannedCall(
      input.workingMessages,
      currentUserIndex,
      resultIndex,
      resultCall,
    );
    if (
      !planned ||
      typeof planned.name !== 'string' ||
      resolveRegisteredToolName(planned.name) !== resultCall.name ||
      planned.arguments !== resultCall.arguments
    ) {
      continue;
    }

    const canonical = resolveUniqueExecutedCanonicalTool(
      input.executedToolDefinitions,
      toolName,
    );
    if (!canonical || !isEligibleStaticEvidenceTool(canonical)) continue;

    const binding = Object.freeze({
      version: BINDING_VERSION,
      executionRunId: input.executionRunId,
      sourceMessageId: message.id,
      sourceToolCallId: resultCall.id,
      sourceToolName: toolName,
      argumentsText: resultCall.arguments,
      visibleResult: message.content,
      argumentsSha256,
      visibleResultSha256,
      canonicalStaticContractDigest: canonicalStaticContractDigest(canonical),
    });
    capabilities.push(mintCapability(binding));
  }
  return Object.freeze(capabilities);
}

export function resolveToolObservedMemoryEvidenceBinding(
  capability: unknown,
): ToolObservedMemoryEvidenceBinding | undefined {
  if (!capability || (typeof capability !== 'object' && typeof capability !== 'function')) {
    return undefined;
  }
  return CAPABILITY_BINDINGS.get(capability as object);
}

function codePointLengthAtMost(value: string, maximum: number): boolean {
  let count = 0;
  for (const _codePoint of value) {
    count += 1;
    if (count > maximum) return false;
  }
  return true;
}

function exactCover(
  subjectStart: number,
  subjectLength: number,
  valueStart: number,
  valueLength: number,
): Omit<ExactEvidenceSpan, 'ok' | 'evidenceSpan'> {
  const evidenceSpanStart = Math.min(subjectStart, valueStart);
  const evidenceSpanEnd = Math.max(subjectStart + subjectLength, valueStart + valueLength);
  return {
    evidenceSpanStart,
    evidenceSpanEnd,
    subjectStart,
    subjectEnd: subjectStart + subjectLength,
    valueStart,
    valueEnd: valueStart + valueLength,
  };
}

/**
 * Finds the smallest exact source span containing both claim parts. Offsets
 * use JavaScript string indices; scanning retains only the current and best
 * occurrence, so auxiliary space remains O(1).
 */
export function deriveExactToolObservedMemoryEvidenceSpan(
  capability: unknown,
  subject: string,
  value: string,
): ToolObservedMemoryEvidenceSpanResult {
  const binding = resolveToolObservedMemoryEvidenceBinding(capability);
  if (!binding) return Object.freeze({ ok: false, reason: 'invalid_capability' });
  if (typeof subject !== 'string' || typeof value !== 'string' || !subject || !value) {
    return Object.freeze({ ok: false, reason: 'invalid_claim_part' });
  }

  const source = binding.visibleResult;
  let subjectStart = source.indexOf(subject);
  let valueStart = source.indexOf(value);
  if (subjectStart < 0 || valueStart < 0) {
    return Object.freeze({ ok: false, reason: 'not_grounded' });
  }

  let best = exactCover(subjectStart, subject.length, valueStart, value.length);
  while (subjectStart >= 0 && valueStart >= 0) {
    const candidate = exactCover(subjectStart, subject.length, valueStart, value.length);
    const candidateLength = candidate.evidenceSpanEnd - candidate.evidenceSpanStart;
    const bestLength = best.evidenceSpanEnd - best.evidenceSpanStart;
    if (
      candidateLength < bestLength ||
      (candidateLength === bestLength && candidate.evidenceSpanStart < best.evidenceSpanStart)
    ) {
      best = candidate;
    }

    if (subjectStart <= valueStart) {
      subjectStart = source.indexOf(subject, subjectStart + 1);
    } else {
      valueStart = source.indexOf(value, valueStart + 1);
    }
  }

  const evidenceSpan = source.slice(best.evidenceSpanStart, best.evidenceSpanEnd);
  if (
    !codePointLengthAtMost(
      evidenceSpan,
      TOOL_OBSERVED_MEMORY_EVIDENCE_MAX_SPAN_CODE_POINTS,
    )
  ) {
    return Object.freeze({ ok: false, reason: 'span_too_large' });
  }
  return Object.freeze({ ok: true, evidenceSpan, ...best });
}

