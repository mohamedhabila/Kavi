import type { Message, ToolCall } from '../../types/message';
import { parseSurfacedSubAgentOutputResult } from '../../services/agents/surfacedSubAgentOutput';
import { truncateLogDetail } from '../../utils/logDetail';

export function extractMessageEffect(result?: string): Message['effectId'] | undefined {
  if (!result) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result);
    if (
      parsed?.effectId === 'confetti' ||
      parsed?.effectId === 'balloons' ||
      parsed?.effectId === 'spotlight'
    ) {
      return parsed.effectId;
    }
  } catch {
    // Ignore malformed tool result payloads.
  }

  return undefined;
}

export function summarizeToolArguments(argumentsText: string): string | undefined {
  try {
    return truncateLogDetail(JSON.stringify(JSON.parse(argumentsText)));
  } catch {
    return truncateLogDetail(argumentsText);
  }
}

export function summarizeToolResult(toolCall: ToolCall): string | undefined {
  if (toolCall.error) {
    return truncateLogDetail(toolCall.error);
  }

  const surfacedOutput = parseSurfacedSubAgentOutputResult(toolCall.result);
  if (surfacedOutput) {
    return truncateLogDetail(
      surfacedOutput.usedFullOutput
        ? `Surfaced worker output from ${surfacedOutput.sessionId}`
        : `Surfaced bounded worker output from ${surfacedOutput.sessionId}`,
    );
  }

  return truncateLogDetail(toolCall.result);
}
