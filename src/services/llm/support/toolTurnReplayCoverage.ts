import type { MessageProviderReplay } from '../../../types/message';
import { isGemini3Model } from '../catalog/providerCapabilities';
import { isPlainRecord } from '../core/json';
import { hasGeminiToolTurnThoughtSignatureCoverage } from '../providers/gemini/thoughtSignatureCoverage';

type PendingToolCallLike = {
  id?: string;
  name?: string;
  raw?: Record<string, unknown>;
};

function resolvePendingToolCallId(toolCall: PendingToolCallLike | undefined): string {
  if (typeof toolCall?.id === 'string' && toolCall.id.trim().length > 0) {
    return toolCall.id.trim();
  }
  const rawId = toolCall?.raw?.id;
  return typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : '';
}

function resolvePendingToolCallName(toolCall: PendingToolCallLike | undefined): string {
  if (typeof toolCall?.name === 'string' && toolCall.name.trim().length > 0) {
    return toolCall.name.trim();
  }
  const raw = toolCall?.raw;
  if (!isPlainRecord(raw)) {
    return '';
  }
  if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
    return raw.name.trim();
  }
  const rawFunction = raw.function;
  if (isPlainRecord(rawFunction) && typeof rawFunction.name === 'string') {
    return rawFunction.name.trim();
  }
  return '';
}

function hasReplayShape(
  providerReplay: MessageProviderReplay | undefined,
): 'gemini' | 'anthropic' | 'openai-responses' | undefined {
  if (Array.isArray(providerReplay?.geminiParts) && providerReplay.geminiParts.length > 0) {
    return 'gemini';
  }
  if (Array.isArray(providerReplay?.anthropicBlocks) && providerReplay.anthropicBlocks.length > 0) {
    return 'anthropic';
  }
  if (
    Array.isArray(providerReplay?.openaiResponseOutput) &&
    providerReplay.openaiResponseOutput.length > 0
  ) {
    return 'openai-responses';
  }
  return undefined;
}

function hasAnthropicToolTurnReplayCoverage(params: {
  pendingToolCalls: ReadonlyArray<PendingToolCallLike>;
  providerReplay?: MessageProviderReplay;
}): boolean {
  if (params.pendingToolCalls.length === 0) {
    return true;
  }

  const toolUseBlocks = (params.providerReplay?.anthropicBlocks ?? []).filter(
    (block) => isPlainRecord(block) && block.type === 'tool_use',
  );
  const requiredCoverageCount = Math.max(toolUseBlocks.length, params.pendingToolCalls.length);
  if (requiredCoverageCount === 0) {
    return true;
  }

  for (let index = 0; index < requiredCoverageCount; index += 1) {
    const block = toolUseBlocks[index];
    const blockId = typeof block?.id === 'string' ? block.id.trim() : '';
    const blockName = typeof block?.name === 'string' ? block.name.trim() : '';
    if (!blockId || !blockName) {
      return false;
    }
  }

  return true;
}

function getOpenAIReplayFunctionCallItems(
  output: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown>[] {
  return output.filter((item) => isPlainRecord(item) && item.type === 'function_call');
}

function resolveOpenAIFunctionCallId(item: Record<string, unknown>): string {
  const callId = item.call_id;
  if (typeof callId === 'string' && callId.trim().length > 0) {
    return callId.trim();
  }
  const itemId = item.id;
  return typeof itemId === 'string' && itemId.trim().length > 0 ? itemId.trim() : '';
}

function resolveOpenAIFunctionCallName(item: Record<string, unknown>): string {
  const name = item.name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : '';
}

function hasOpenAIResponsesToolTurnReplayCoverage(params: {
  model: string;
  pendingToolCalls: ReadonlyArray<PendingToolCallLike>;
  providerReplay?: MessageProviderReplay;
}): boolean {
  if (params.pendingToolCalls.length === 0) {
    return true;
  }

  const replayOutput = (params.providerReplay?.openaiResponseOutput ?? []).filter(isPlainRecord);
  const functionCallItems = getOpenAIReplayFunctionCallItems(replayOutput);
  const requiredCoverageCount = Math.max(functionCallItems.length, params.pendingToolCalls.length);
  if (requiredCoverageCount === 0) {
    return true;
  }

  for (let index = 0; index < requiredCoverageCount; index += 1) {
    const item = functionCallItems[index];
    if (!isPlainRecord(item)) {
      return false;
    }
    const callId = resolveOpenAIFunctionCallId(item);
    const name = resolveOpenAIFunctionCallName(item);
    if (!callId || !name) {
      return false;
    }
  }

  return true;
}

function hasCompatibleToolTurnReplayCoverage(params: {
  pendingToolCalls: ReadonlyArray<PendingToolCallLike>;
}): boolean {
  if (params.pendingToolCalls.length === 0) {
    return true;
  }

  return params.pendingToolCalls.every((toolCall) => {
    const id = resolvePendingToolCallId(toolCall);
    const name = resolvePendingToolCallName(toolCall);
    return Boolean(id && name);
  });
}

function resolveReplayCoverageRoute(params: {
  model: string;
  providerReplay?: MessageProviderReplay;
}): 'gemini' | 'anthropic' | 'openai-responses' | 'compatible' {
  const replayShape = hasReplayShape(params.providerReplay);
  if (replayShape) {
    return replayShape;
  }

  if (isGemini3Model(params.model)) {
    return 'gemini';
  }

  return 'compatible';
}

export function hasProviderToolTurnReplayCoverage(params: {
  model: string;
  pendingToolCalls: ReadonlyArray<PendingToolCallLike>;
  providerReplay?: MessageProviderReplay;
}): boolean {
  if (params.pendingToolCalls.length === 0) {
    return true;
  }

  const route = resolveReplayCoverageRoute(params);

  switch (route) {
    case 'gemini':
      return hasGeminiToolTurnThoughtSignatureCoverage({
        model: params.model,
        pendingToolCalls: params.pendingToolCalls,
        providerReplay: params.providerReplay,
      });
    case 'anthropic':
      return hasAnthropicToolTurnReplayCoverage(params);
    case 'openai-responses':
      return hasOpenAIResponsesToolTurnReplayCoverage(params);
    case 'compatible':
    default:
      return hasCompatibleToolTurnReplayCoverage(params);
  }
}
