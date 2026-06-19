import type { ToolCall } from '../types/message';

type ToolCallMatchCandidate = Pick<ToolCall, 'id' | 'name' | 'arguments' | 'raw'>;

const SYNTHETIC_TOOL_CALL_ID_PATTERNS = [/^gemini-call-\d+(?:-[0-9a-f]{8})?(?:-\d+)?$/i];

function isPlainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isStableToolCallIdentity(value: unknown): value is string {
  const normalized = getNonEmptyString(value);
  if (!normalized) {
    return false;
  }

  return !SYNTHETIC_TOOL_CALL_ID_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSyntheticToolCallIdentity(value: unknown): value is string {
  const normalized = getNonEmptyString(value);
  if (!normalized) {
    return false;
  }

  return SYNTHETIC_TOOL_CALL_ID_PATTERNS.some((pattern) => pattern.test(normalized));
}

function haveSameToolShape(
  left: ToolCallMatchCandidate | undefined,
  right: ToolCallMatchCandidate | undefined,
): boolean {
  return (
    getNonEmptyString(left?.name) === getNonEmptyString(right?.name) &&
    getNonEmptyString(left?.arguments) === getNonEmptyString(right?.arguments)
  );
}

function hasExplicitIdentity(toolCall: ToolCallMatchCandidate | undefined): boolean {
  if (!toolCall) {
    return false;
  }

  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : undefined;
  const openAi = isPlainRecord(raw?._openai) ? raw._openai : undefined;

  return [toolCall.id, raw?.id, openAi?.callId, openAi?.itemId].some(
    (candidate) => !!getNonEmptyString(candidate),
  );
}

function getIdentityStrings(toolCall: ToolCallMatchCandidate | undefined): Set<string> {
  const identities = new Set<string>();
  if (!toolCall) {
    return identities;
  }

  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : undefined;
  const openAi = isPlainRecord(raw?._openai) ? raw._openai : undefined;

  for (const candidate of [openAi?.callId, openAi?.itemId, toolCall.id, raw?.id]) {
    if (isStableToolCallIdentity(candidate)) {
      identities.add(candidate.trim());
    }
  }

  return identities;
}

function getStreamIndex(toolCall: ToolCallMatchCandidate | undefined): number | undefined {
  if (!toolCall) {
    return undefined;
  }

  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : undefined;
  const openAi = isPlainRecord(raw?._openai) ? raw._openai : undefined;

  if (typeof openAi?.outputIndex === 'number' && Number.isFinite(openAi.outputIndex)) {
    return openAi.outputIndex;
  }

  if (typeof raw?.index === 'number' && Number.isFinite(raw.index)) {
    return raw.index;
  }

  return undefined;
}

export function areSameLogicalToolCall(
  left: ToolCallMatchCandidate | undefined,
  right: ToolCallMatchCandidate | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  const leftIdentities = getIdentityStrings(left);
  const rightIdentities = getIdentityStrings(right);
  if (leftIdentities.size > 0 || rightIdentities.size > 0) {
    for (const candidate of leftIdentities) {
      if (rightIdentities.has(candidate)) {
        return true;
      }
    }

    return false;
  }

  if (hasExplicitIdentity(left) || hasExplicitIdentity(right)) {
    return false;
  }

  const leftStreamIndex = getStreamIndex(left);
  const rightStreamIndex = getStreamIndex(right);
  const leftName = getNonEmptyString(left.name);
  const rightName = getNonEmptyString(right.name);

  return (
    leftStreamIndex !== undefined &&
    rightStreamIndex !== undefined &&
    leftStreamIndex === rightStreamIndex &&
    leftName !== undefined &&
    rightName !== undefined &&
    leftName === rightName
  );
}

export function findMatchingToolCallIndex<T extends ToolCallMatchCandidate>(
  toolCalls: T[],
  nextToolCall: ToolCallMatchCandidate,
): number {
  return toolCalls.findIndex((candidate) => areSameLogicalToolCall(candidate, nextToolCall));
}

export function findMatchingToolCallIndexWithinMessage<T extends ToolCallMatchCandidate>(
  toolCalls: T[],
  nextToolCall: ToolCallMatchCandidate,
): number {
  const nextId = getNonEmptyString(nextToolCall.id);
  if (nextId && isStableToolCallIdentity(nextId)) {
    const exactIdIndex = toolCalls.findIndex(
      (candidate) => getNonEmptyString(candidate.id) === nextId,
    );
    if (exactIdIndex >= 0) {
      return exactIdIndex;
    }
  }
  if (nextId && isSyntheticToolCallIdentity(nextId)) {
    const exactSyntheticIdIndex = toolCalls.findIndex(
      (candidate) =>
        getNonEmptyString(candidate.id) === nextId && haveSameToolShape(candidate, nextToolCall),
    );
    if (exactSyntheticIdIndex >= 0) {
      return exactSyntheticIdIndex;
    }
  }

  return findMatchingToolCallIndex(toolCalls, nextToolCall);
}

export function mergeMatchingToolCall(
  existingToolCall: ToolCall | undefined,
  incomingToolCall: ToolCall,
): ToolCall {
  return {
    ...existingToolCall,
    ...incomingToolCall,
    raw: incomingToolCall.raw ?? existingToolCall?.raw,
    startedAt: incomingToolCall.startedAt ?? existingToolCall?.startedAt,
    updatedAt: incomingToolCall.updatedAt ?? existingToolCall?.updatedAt,
    completedAt: incomingToolCall.completedAt ?? existingToolCall?.completedAt,
    progressText: incomingToolCall.progressText ?? existingToolCall?.progressText,
    result: incomingToolCall.result ?? existingToolCall?.result,
    error: incomingToolCall.error ?? existingToolCall?.error,
  };
}

export function mergeMatchingToolCalls(
  existingToolCalls: ToolCall[] | undefined,
  incomingToolCalls: ToolCall[] | undefined,
): ToolCall[] | undefined {
  if (!incomingToolCalls?.length) {
    return existingToolCalls?.length ? [...existingToolCalls] : undefined;
  }

  if (!existingToolCalls?.length) {
    return [...incomingToolCalls];
  }

  const mergedToolCalls = [...existingToolCalls];
  for (const incomingToolCall of incomingToolCalls) {
    const existingIndex = findMatchingToolCallIndex(mergedToolCalls, incomingToolCall);
    if (existingIndex < 0) {
      mergedToolCalls.push(incomingToolCall);
      continue;
    }

    mergedToolCalls[existingIndex] = mergeMatchingToolCall(
      mergedToolCalls[existingIndex],
      incomingToolCall,
    );
  }

  return mergedToolCalls;
}
