import type { Message } from '../../types/message';
import { getDynamicMcpCatalog, getDynamicSkillCatalog } from '../tools/builtin-tool-catalogDynamic';
import {
  isRegisteredToolName,
  normalizeToolName,
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
