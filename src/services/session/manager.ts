// ---------------------------------------------------------------------------
// Kavi — Session Management
// ---------------------------------------------------------------------------
// Idle reset, export, conversation search, folders/tags.

import { useChatStore } from '../../store/useChatStore';
import type { Conversation, Message } from '../../types';
import { unrefTimerIfSupported } from '../../utils/timers';

// ── Session Idle/Daily Reset ─────────────────────────────────────────────

let idleTimer: ReturnType<typeof setTimeout> | null = null;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function resetIdleTimer(onIdle: () => void, timeoutMs = DEFAULT_IDLE_TIMEOUT_MS): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(onIdle, timeoutMs);
  unrefTimerIfSupported(idleTimer);
}

export function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

// ── Chat Export ──────────────────────────────────────────────────────────

export function exportConversationAsMarkdown(conversation: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title}`);
  lines.push(`\n_Created: ${new Date(conversation.createdAt).toLocaleString()}_\n`);

  for (const msg of conversation.messages) {
    const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    const time = new Date(msg.timestamp).toLocaleTimeString();
    lines.push(`\n## ${role} (${time})\n`);
    lines.push(msg.content);

    if (msg.toolCalls?.length) {
      lines.push('\n### Tool Calls\n');
      for (const tc of msg.toolCalls) {
        lines.push(`- **${tc.name}**: ${tc.status}`);
        if (tc.result) lines.push(`  Result: ${tc.result.slice(0, 200)}`);
      }
    }
  }

  return lines.join('\n');
}
