import { exportConversationAsMarkdown } from '../../../services/session/manager';
import { loadAllArchivedMessages } from '../../../services/transcriptArchive/transcriptArchive';
import { shareTextExport } from '../../../services/share/localShare';
import type { Conversation, ConversationLogEntry } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import { generateId } from '../../../utils/id';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('ForegroundCommandResult');

/** Archived history for an export; the in-memory part still exports when it cannot load. */
function loadArchivedHistoryForExport(conversation: Conversation): Message[] {
  try {
    return loadAllArchivedMessages(
      conversation.id,
      new Set(conversation.messages.map((message) => message.id)),
    );
  } catch (error: unknown) {
    logger.warn('Exporting without archived history; it could not be read.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

type ForegroundCommandResult = {
  action?: string;
  response?: string;
};

type ForegroundCommandResultControllerAccessors = {
  getConversation: () => Conversation | undefined;
  getCurrentAssistantMessageId: () => string;
};

type ForegroundCommandResultControllerActions = {
  appendConversationLog: (entry: ConversationLogEntry) => void;
  /** Starts a fresh context in the conversation (see `resetConversationContext`). */
  resetContext: () => void;
  updateAssistantMessage: (messageId: string, content: string) => void;
};

function buildCommandResultLogEntry(result: ForegroundCommandResult): ConversationLogEntry {
  return {
    id: generateId(),
    timestamp: Date.now(),
    kind: 'command',
    level: 'success',
    title: result.action ? `Command result: ${result.action}` : 'Command result',
    detail: result.response,
  };
}

export function buildForegroundConversationExportFileName(title: string): string {
  const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
  return `${sanitizedTitle || 'conversation'}.md`;
}

export function createForegroundCommandResultController(params: {
  accessors: ForegroundCommandResultControllerAccessors;
  actions: ForegroundCommandResultControllerActions;
  exportDialogTitle: string;
}) {
  return {
    async handleCommandResult(result: ForegroundCommandResult): Promise<void> {
      if (result.response) {
        params.actions.updateAssistantMessage(
          params.accessors.getCurrentAssistantMessageId(),
          result.response,
        );
      }

      params.actions.appendConversationLog(buildCommandResultLogEntry(result));

      if (result.action === 'clear_context') {
        params.actions.resetContext();
        return;
      }

      if (result.action !== 'export') {
        return;
      }

      const conversation = params.accessors.getConversation();
      if (!conversation) {
        return;
      }

      try {
        const earlierMessages = loadArchivedHistoryForExport(conversation);
        await shareTextExport({
          content: exportConversationAsMarkdown(conversation, earlierMessages),
          fileName: buildForegroundConversationExportFileName(conversation.title),
          dialogTitle: params.exportDialogTitle,
          mimeType: 'text/markdown',
        });
      } catch {
        // Export is best-effort.
      }
    },
  };
}
