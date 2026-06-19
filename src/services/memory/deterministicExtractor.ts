// ---------------------------------------------------------------------------
// Kavi — Structural Memory Extractor
// ---------------------------------------------------------------------------
// Language-agnostic, structural extraction from a completed turn.
// Uses message metadata, tool calls, and message structure — never language
// patterns or regex. Works for any language, code, mixed content.
//
// Design: episodes and working blocks are created from structure alone.
// Fact extraction requires semantic understanding and is delegated to the
// active chat provider when available.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type { ConsolidatorFact, ConsolidatorTurnInput } from './consolidator';

const MAX_STRUCTURAL_FACTS = 5;
const DIRECT_MEMORY_TOOL_REASON = 'Direct memory_remember tool call arguments.';

export interface StructuralExtraction {
  /** Always created from the turn structure */
  episodeSummary: string;
  /** Focus inferred from structure (tool calls, code blocks, thread title) */
  activeFocus: string | null;
  /** Open threads from explicit tool evidence or checklist structure */
  openThreads: string[];
  /** Facts extracted from universal structural signals only */
  facts: ConsolidatorFact[];
}

const MAX_FOCUS_CHARS = 600;

/**
 * Restrict structural extraction to the closed turn window so prior-turn tool
 * traces do not leak into focus, episodes, or facts for the current turn.
 */
export function sliceClosedTurnMessages(
  messages: Message[],
  sourceUserMessageId?: string,
  sourceAssistantMessageId?: string,
): Message[] {
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
  const userText = (input.userMessage ?? '').trim();

  // Episode is always built from structure
  const episodeSummary = buildStructuralEpisodeSummary(messages, userText);

  // Focus is inferred from structural signals
  const activeFocus = inferStructuralFocus(messages, input.threadTitle);

  // Open threads from explicit checklist / todo structure in messages
  const openThreads = extractStructuredOpenThreads(messages);

  // Facts: only from structural signals that are language-independent
  const facts = extractStructuralFacts(messages);

  return { episodeSummary, activeFocus, openThreads, facts };
}

// ── Episode summary (language-agnostic) ────────────────────────────────────

function buildStructuralEpisodeSummary(messages: Message[], userText: string): string {
  const parts: string[] = [];

  // User intent from first user message in window
  const userPreview = userText.slice(0, 120).trim();
  if (userPreview) parts.push(userPreview);

  // Tool call summary (universal)
  const toolNames = new Set<string>();
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.name) toolNames.add(tc.name);
    }
  }
  if (toolNames.size > 0) {
    parts.push(`[${Array.from(toolNames).join(', ')}]`);
  }

  // Code block presence (structural signal)
  const hasCode = messages.some((m) => (m.content ?? '').includes('```'));
  if (hasCode) parts.push('[code]');

  // Attachment presence
  const hasAttachments = messages.some((m) => (m.attachments ?? []).length > 0);
  if (hasAttachments) parts.push('[attachments]');

  return parts.join(' | ').slice(0, 600) || 'Turn completed';
}

// ── Focus inference (structural) ───────────────────────────────────────────

function inferStructuralFocus(messages: Message[], threadTitle?: string): string | null {
  const toolCalls = messages.flatMap((m) => m.toolCalls ?? []);
  const toolNames = toolCalls.map((tc) => tc.name).filter(Boolean);

  // If tools ran, focus is the tool workflow
  if (toolNames.length > 0) {
    const unique = Array.from(new Set(toolNames)).slice(0, 4);
    const focus = `Running: ${unique.join(', ')}`;
    return threadTitle
      ? `${threadTitle} — ${focus}`.slice(0, MAX_FOCUS_CHARS)
      : focus.slice(0, MAX_FOCUS_CHARS);
  }

  // If code blocks exist, focus is coding
  const codeLangs = extractCodeLanguages(messages);
  if (codeLangs.length > 0) {
    const focus = `Coding: ${codeLangs.join(', ')}`;
    return threadTitle
      ? `${threadTitle} — ${focus}`.slice(0, MAX_FOCUS_CHARS)
      : focus.slice(0, MAX_FOCUS_CHARS);
  }

  // Fallback to thread title
  if (threadTitle) {
    return `Working on: ${threadTitle.slice(0, MAX_FOCUS_CHARS - 14)}`;
  }

  return null;
}

function extractCodeLanguages(messages: Message[]): string[] {
  const langs = new Set<string>();
  for (const m of messages) {
    const content = m.content ?? '';
    const matches = content.match(/```([a-zA-Z0-9_+-]+)/g);
    if (matches) {
      for (const match of matches) {
        const lang = match.slice(3).trim().toLowerCase();
        if (lang && lang !== 'plaintext') langs.add(lang);
      }
    }
  }
  return Array.from(langs).slice(0, 3);
}

// ── Open threads (structural) ──────────────────────────────────────────────

function extractStructuredOpenThreads(messages: Message[]): string[] {
  const threads: string[] = [];

  for (const m of messages) {
    const content = m.content ?? '';
    // Check for explicit checklist items (markdown task lists)
    const checklistMatches = content.match(/- \[ \]\s*(.+)/g);
    if (checklistMatches) {
      for (const match of checklistMatches) {
        const item = match.replace(/- \[ \]\s*/, '').trim();
        if (item.length > 3 && item.length <= 80) threads.push(item);
      }
    }
    // Check for numbered lists that might be steps
    const numberedMatches = content.match(/^\d+\.\s+(.{5,80})$/gm);
    if (numberedMatches) {
      for (const match of numberedMatches.slice(0, 3)) {
        const item = match.replace(/^\d+\.\s*/, '').trim();
        if (item.length > 3 && !threads.includes(item)) threads.push(item);
      }
    }
  }

  return threads.slice(0, 5);
}

// ── Structural facts (language-agnostic) ───────────────────────────────────

function extractStructuralFacts(messages: Message[]): ConsolidatorFact[] {
  const facts: ConsolidatorFact[] = [];

  // Fact 1: Direct structured memory writes from executed tool calls.
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.name !== 'memory_remember') continue;
      const fact = memoryRememberToolCallToFact(tc.arguments);
      if (fact) {
        facts.push(fact);
        if (facts.length >= MAX_STRUCTURAL_FACTS) return facts;
      }
    }
  }

  // Fact 2: Tool outcomes — universally meaningful regardless of language
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const toolName = m.toolCalls?.[0]?.name ?? 'tool';
    const content = (m.content ?? '').trim();
    // Only capture structured tool results (JSON) as they indicate outcomes
    if (content.startsWith('{') && content.length > 10 && content.length < 300) {
      try {
        const parsed = JSON.parse(content);
        const status = parsed.status ?? parsed.ok ?? parsed.success ?? parsed.result;
        if (status !== undefined) {
          facts.push({
            subject: 'system',
            predicate: 'tool_result',
            value: `${toolName}: ${String(status).slice(0, 120)}`,
            scope: 'conversation',
            importance: 0.55,
            confidence: 0.8,
            reason: 'Tool execution result captured.',
          });
          if (facts.length >= MAX_STRUCTURAL_FACTS) return facts;
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  }

  // Fact 3: File operations — detected by tool name, not language
  const fileTools = ['write_file', 'file_edit', 'apply_patch', 'read_file'];
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.name && fileTools.includes(tc.name)) {
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
              reason: 'File operation detected.',
            });
            if (facts.length >= MAX_STRUCTURAL_FACTS) return facts;
          }
        } catch {
          // Skip malformed args
        }
      }
    }
  }

  // Fact 4: Sub-agent spawning — structural
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.name === 'sessions_spawn') {
        try {
          const args = JSON.parse(tc.arguments ?? '{}');
          const prompt = args.prompt ?? '';
          facts.push({
            subject: 'system',
            predicate: 'delegated_task',
            value: prompt.slice(0, 160),
            scope: 'conversation',
            importance: 0.65,
            confidence: 0.85,
            reason: 'Sub-agent delegated.',
          });
          if (facts.length >= MAX_STRUCTURAL_FACTS) return facts;
        } catch {
          // Skip
        }
      }
    }
  }

  return facts;
}

function memoryRememberToolCallToFact(argumentsJson: string | undefined): ConsolidatorFact | null {
  const args = parseJsonRecord(argumentsJson ?? '{}');
  if (!args) return null;

  const subject = normalizedBoundedString(args.subject, 80);
  const predicate = normalizedBoundedString(args.predicate, 80);
  const value = normalizedBoundedString(args.value, 200);
  if (!subject || !predicate || !value) return null;

  const scope = parseStructuralFactScope(args.scope);
  const confidence = typeof args.confidence === 'number' ? clamp01(args.confidence) : undefined;
  const importance = typeof args.importance === 'number' ? clamp01(args.importance) : undefined;

  return {
    subject,
    predicate,
    value,
    ...(scope ? { scope } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(importance !== undefined ? { importance } : {}),
    reason: DIRECT_MEMORY_TOOL_REASON,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizedBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function parseStructuralFactScope(value: unknown): ConsolidatorFact['scope'] | undefined {
  return value === 'global' ||
    value === 'project' ||
    value === 'conversation' ||
    value === 'session' ||
    value === 'persona'
    ? value
    : undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
