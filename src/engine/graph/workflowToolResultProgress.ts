import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { collectAgentControlGraphDelegatedCompletedToolNames } from './delegatedToolEvidence';

export interface AgentControlGraphWorkflowToolResultProgress {
  observedToolName?: string;
  newlyCompletedToolNames: string[];
  nextCompletedToolNames: string[];
}

type WorkflowProgressToolMessage = Pick<Message, 'content' | 'isError' | 'timestamp' | 'toolCalls'>;

export function buildAgentControlGraphWorkflowToolResultProgress(params: {
  toolMessage: WorkflowProgressToolMessage;
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>;
  completedToolNames: Iterable<string>;
  reason: string;
}): AgentControlGraphWorkflowToolResultProgress {
  const nextCompletedToolNames = new Set(
    Array.from(params.completedToolNames).map(normalizeToolName).filter(Boolean),
  );
  const newlyCompletedToolNames: string[] = [];

  if (!params.toolMessage.isError) {
    const toolName = params.toolMessage.toolCalls?.[0]?.name;
    if (toolName?.trim()) {
      const normalizedToolName = normalizeToolName(toolName);
      if (normalizedToolName && !nextCompletedToolNames.has(normalizedToolName)) {
        nextCompletedToolNames.add(normalizedToolName);
        newlyCompletedToolNames.push(normalizedToolName);
      }
      for (const delegatedToolName of collectAgentControlGraphDelegatedCompletedToolNames({
        hostToolName: normalizedToolName,
        result: params.toolMessage.content,
        isError: params.toolMessage.isError,
      })) {
        if (!nextCompletedToolNames.has(delegatedToolName)) {
          nextCompletedToolNames.add(delegatedToolName);
          newlyCompletedToolNames.push(delegatedToolName);
        }
      }
    }
  }

  return {
    newlyCompletedToolNames,
    nextCompletedToolNames: Array.from(nextCompletedToolNames),
    ...(newlyCompletedToolNames[0] ? { observedToolName: newlyCompletedToolNames[0] } : {}),
  };
}
