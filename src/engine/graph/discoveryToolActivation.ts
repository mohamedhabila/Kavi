import type { Message } from '../../types/message';
import { getDynamicMcpCatalog, getDynamicSkillCatalog } from '../tools/builtin-tool-catalogDynamic';
import {
  isRegisteredToolName,
  normalizeToolName,
  normalizeToolNameList,
  resolveRegisteredToolName,
} from '../tools/toolNameNormalization';

export const DISCOVERY_ACTIVATION_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);

function getDynamicDiscoverableToolNames(): Set<string> {
  return new Set([
    ...getDynamicMcpCatalog().tools.map((tool) => normalizeToolName(tool.name)),
    ...getDynamicSkillCatalog().tools.map((tool) => normalizeToolName(tool.name)),
  ]);
}

function resolveCatalogActivationToolName(
  name: unknown,
  getDynamicToolNames: () => ReadonlySet<string>,
): string {
  if (typeof name !== 'string') {
    return '';
  }
  const normalized = normalizeToolName(name);
  if (!normalized) {
    return '';
  }
  if (isRegisteredToolName(normalized)) {
    return resolveRegisteredToolName(normalized);
  }
  if (getDynamicToolNames().has(normalized)) {
    return normalized;
  }
  return '';
}

function resolveActivationNameFromToolEntry(
  tool: unknown,
  getDynamicToolNames: () => ReadonlySet<string>,
): string {
  if (!tool || typeof tool !== 'object') {
    return '';
  }
  const record = tool as {
    name?: unknown;
    activation?: {
      name?: unknown;
      eligible?: unknown;
    };
  };
  if (record.activation && record.activation.eligible !== true) {
    return '';
  }
  return resolveCatalogActivationToolName(
    record.activation?.name ?? record.name,
    getDynamicToolNames,
  );
}

export function collectActivatedToolNamesFromDiscoveryPayload(payload: unknown): string[] {
  const activated: string[] = [];
  if (!payload || typeof payload !== 'object') {
    return activated;
  }
  let dynamicToolNames: ReadonlySet<string> | undefined;
  const getDynamicToolNames = () => {
    dynamicToolNames ??= getDynamicDiscoverableToolNames();
    return dynamicToolNames;
  };

  const record = payload as {
    tools?: Array<{ name?: unknown }>;
    tool?: { name?: unknown };
  };

  if (Array.isArray(record.tools)) {
    for (const tool of record.tools) {
      const activatedName = resolveActivationNameFromToolEntry(tool, getDynamicToolNames);
      if (activatedName) {
        activated.push(activatedName);
      }
    }
  }

  const describedName = resolveActivationNameFromToolEntry(record.tool, getDynamicToolNames);
  if (describedName) {
    activated.push(describedName);
  }

  return activated;
}

export function extractDiscoveryActivatedToolNames(
  messagesSinceLatestUserMessage: ReadonlyArray<Message>,
): Set<string> {
  const toolCallNamesById = new Map<string, string>();
  for (const message of messagesSinceLatestUserMessage) {
    for (const toolCall of message.toolCalls ?? []) {
      const toolName = normalizeToolName(toolCall.name);
      const toolCallId = toolCall.id?.trim();
      if (toolCallId) {
        toolCallNamesById.set(toolCallId, toolName);
      }
    }
  }

  for (let index = messagesSinceLatestUserMessage.length - 1; index >= 0; index -= 1) {
    const message = messagesSinceLatestUserMessage[index];
    if (message?.role !== 'tool') {
      continue;
    }

    const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId.trim() : '';
    const toolName =
      (toolCallId ? toolCallNamesById.get(toolCallId) : undefined) ??
      normalizeToolName(message.toolCalls?.[0]?.name ?? '');
    if (!DISCOVERY_ACTIVATION_TOOL_NAMES.has(toolName)) {
      continue;
    }

    try {
      const parsed = JSON.parse(message.content);
      const activated = collectActivatedToolNamesFromDiscoveryPayload(parsed);
      if (activated.length > 0) {
        return new Set(activated);
      }
    } catch {
      continue;
    }
  }

  return new Set<string>();
}

export function extractActivatedToolNamesFromDiscoveryToolResult(
  toolName: string,
  content: string,
): string[] {
  const normalizedToolName = normalizeToolName(toolName);
  if (!DISCOVERY_ACTIVATION_TOOL_NAMES.has(normalizedToolName)) {
    return [];
  }

  try {
    const parsed = JSON.parse(content);
    return collectActivatedToolNamesFromDiscoveryPayload(parsed);
  } catch {
    return [];
  }
}

export function selectOneShotDiscoveryToolCalls<T extends { name?: string }>(
  toolCalls: ReadonlyArray<T>,
): T[] {
  const firstDiscoveryIndex = toolCalls.findIndex((toolCall) =>
    DISCOVERY_ACTIVATION_TOOL_NAMES.has(normalizeToolName(toolCall.name ?? '')),
  );
  if (firstDiscoveryIndex < 0) {
    return [...toolCalls];
  }
  const discoveryCall = toolCalls[firstDiscoveryIndex];
  return discoveryCall ? [discoveryCall] : [];
}

export function mergeSessionActivatedToolNames(
  existing: ReadonlyArray<string> | undefined,
  activated: Iterable<string>,
): string[] {
  return normalizeToolNameList([...(existing ?? []), ...activated]);
}

export function mergeActivatedCatalogToolNames(
  turnActivated: ReadonlySet<string>,
  sessionActivated?: ReadonlyArray<string>,
): Set<string> {
  const merged = new Set(normalizeToolNameList([...turnActivated]));
  for (const toolName of normalizeToolNameList(sessionActivated)) {
    merged.add(toolName);
  }
  return merged;
}

export function hasUnresolvedDiscoveryToolCallInTurn(
  messagesSinceLatestUserMessage: ReadonlyArray<Message>,
): boolean {
  const pendingDiscoveryCallIds = new Set<string>();

  for (const message of messagesSinceLatestUserMessage) {
    if (message.role === 'assistant') {
      for (const toolCall of message.toolCalls ?? []) {
        const toolName = normalizeToolName(toolCall.name);
        const toolCallId = toolCall.id?.trim();
        if (DISCOVERY_ACTIVATION_TOOL_NAMES.has(toolName) && toolCallId) {
          pendingDiscoveryCallIds.add(toolCallId);
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId.trim() : '';
      if (toolCallId) {
        pendingDiscoveryCallIds.delete(toolCallId);
      }
    }
  }

  return pendingDiscoveryCallIds.size > 0;
}
