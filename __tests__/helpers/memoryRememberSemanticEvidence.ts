import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import {
  bindCurrentTurnToolObservedMemoryEvidence,
  type CurrentRunCompletedToolResult,
} from '../../src/services/memory/toolObservedMemoryEvidence';
import type { Message } from '../../src/types/message';
import { sha256HexUtf8 } from '../../src/utils/sha256';

export function bindReadFileEvidence(params: {
  executionRunId: string;
  userMessageId: string;
  userMessageText: string;
  result: string;
}) {
  const readFile = TOOL_DEFINITIONS.find((tool) => tool.name === 'read_file');
  if (!readFile) throw new Error('Missing read_file definition');
  const argumentsText = '{"path":"policies/release-artifact-rules.txt"}';
  const toolCallId = 'tool-call-read-release-policy';
  const toolMessageId = 'message-tool-read-release-policy';
  const messages: Message[] = [
    {
      id: params.userMessageId,
      role: 'user',
      content: params.userMessageText,
      timestamp: 1,
    },
    {
      id: 'message-assistant-read-release-policy',
      role: 'assistant',
      content: '',
      timestamp: 2,
      toolCalls: [
        {
          id: toolCallId,
          name: 'read_file',
          arguments: argumentsText,
          status: 'pending',
        },
      ],
    },
    {
      id: toolMessageId,
      role: 'tool',
      content: params.result,
      timestamp: 3,
      toolCallId,
      toolCalls: [
        {
          id: toolCallId,
          name: 'read_file',
          arguments: argumentsText,
          status: 'completed',
          result: params.result,
        },
      ],
    },
  ];
  const completion: CurrentRunCompletedToolResult = {
    executionRunId: params.executionRunId,
    sourceMessageId: toolMessageId,
    sourceToolCallId: toolCallId,
    sourceToolName: 'read_file',
    argumentsSha256: sha256HexUtf8(argumentsText),
    visibleResultSha256: sha256HexUtf8(params.result),
    visibleResultFidelity: 'complete',
  };
  return bindCurrentTurnToolObservedMemoryEvidence({
    executionRunId: params.executionRunId,
    currentUserMessageId: params.userMessageId,
    workingMessages: messages,
    executedToolDefinitions: [readFile],
    currentRunCompletedToolResults: [completion],
  });
}
