// ---------------------------------------------------------------------------
// Kavi — Structural Memory Extractor
// ---------------------------------------------------------------------------
// Language-agnostic, structural extraction from a completed turn.
// Uses message metadata, tool calls, and message structure — never language
// patterns or regex. Works for any language, code, mixed content.
//
// Design: provider-unavailable episodes contain only content-free structure.
// Semantic summaries, focus, open threads, and facts require provider evidence.
// Exact tool outcomes may contribute only code-owned structured facts.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type {
  ConsolidatorFact,
  ConsolidatorSourceMessage,
  ConsolidatorTurnInput,
} from './consolidator';
import { codeOwnedMemorySensitivityDeclaration } from './memorySensitivityPolicy';

const MAX_STRUCTURAL_FACTS = 5;

export interface StructuralExtraction {
  /** Content-free descriptor used until semantic provider enrichment succeeds. */
  episodeSummary: string;
  /** Facts extracted from universal structural signals only */
  facts: ConsolidatorFact[];
}

/**
 * Restrict structural extraction to the closed turn window so prior-turn tool
 * traces do not leak into focus, episodes, or facts for the current turn.
 */
export function sliceClosedTurnMessages(
  messages: ConsolidatorSourceMessage[],
  sourceUserMessageId?: string,
  sourceAssistantMessageId?: string,
): ConsolidatorSourceMessage[] {
  if (!messages.length) return messages;
  if (!sourceUserMessageId && !sourceAssistantMessageId) return messages;

  const userIndex = sourceUserMessageId
    ? messages.findIndex((message) => message.id === sourceUserMessageId)
    : -1;
  const assistantIndex = sourceAssistantMessageId
    ? messages.findIndex((message) => message.id === sourceAssistantMessageId)
    : -1;

  if (userIndex < 0 && assistantIndex < 0) return messages;

  const startIndex = userIndex >= 0 ? userIndex : 0;
  const endIndex = assistantIndex >= 0 ? assistantIndex : messages.length - 1;
  if (startIndex > endIndex) return messages;

  return messages.slice(startIndex, endIndex + 1);
}

export function extractStructuralMemory(input: ConsolidatorTurnInput): StructuralExtraction {
  const messages = sliceClosedTurnMessages(
    input.messages ?? [],
    input.sourceUserMessageId,
    input.sourceAssistantMessageId,
  );
  const episodeSummary = buildStructuralEpisodeSummary(messages);

  // Facts: only from structural signals that are language-independent
  const facts = extractStructuralFacts(messages);

  return { episodeSummary, facts };
}

// ── Episode summary (language-agnostic) ────────────────────────────────────

function buildStructuralEpisodeSummary(messages: ConsolidatorSourceMessage[]): string {
  const completedToolCallIds = new Set(
    messages.flatMap((message) =>
      message.role === 'tool' && message.toolCallId ? [message.toolCallId] : [],
    ),
  );
  const toolCalls = messages.flatMap((message) => message.toolCalls ?? []);
  const hasAttachments = messages.some(
    (message) => message.hasAttachments === true || (message.attachments ?? []).length > 0,
  );
  return JSON.stringify({
    kind: 'structural_turn',
    version: 1,
    messageCount: messages.length,
    toolCallCount: toolCalls.length,
    completedToolCallCount: toolCalls.filter(
      (toolCall) => toolCall.id && completedToolCallIds.has(toolCall.id),
    ).length,
    hasCodeBlock: messages.some((message) => (message.content ?? '').includes('```')),
    hasAttachments,
  });
}

// ── Structural facts (language-agnostic) ───────────────────────────────────

function extractStructuralFacts(messages: Message[]): ConsolidatorFact[] {
  const facts: ConsolidatorFact[] = [];
  const observedToolResults = new Map<string, string>();
  for (const message of messages) {
    if (
      message.role === 'tool' &&
      typeof message.toolCallId === 'string' &&
      message.toolCallId.length > 0 &&
      typeof message.id === 'string' &&
      message.id.length > 0 &&
      !observedToolResults.has(message.toolCallId)
    ) {
      observedToolResults.set(message.toolCallId, message.id);
    }
  }

  // Fact 1: File operations — detected by tool name, not language
  const fileTools = ['write_file', 'file_edit', 'apply_patch', 'read_file'];
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      const evidenceMessageId = tc.id ? observedToolResults.get(tc.id) : undefined;
      if (tc.name && fileTools.includes(tc.name) && evidenceMessageId) {
        try {
          const args = JSON.parse(tc.arguments ?? '{}');
          const path = args.path ?? args.filePath ?? args.file_path;
          if (path) {
            facts.push({
              subject: 'system',
              predicate: 'file_operation',
              value: `${tc.name} ${String(path).slice(0, 120)}`,
              scope: 'conversation',
              importance: 0.6,
              confidence: 0.9,
              evidenceMessageIds: [evidenceMessageId],
              reason: 'Tool invocation and matching result observed.',
              sealedApplicability: {
                factClass: 'workflow',
                sourceAuthority: 'tool_observed',
              },
              sensitivityDeclaration: codeOwnedMemorySensitivityDeclaration(),
            });
            if (facts.length >= MAX_STRUCTURAL_FACTS) return facts;
          }
        } catch {
          // Skip malformed args
        }
      }
    }
  }

  return facts;
}
