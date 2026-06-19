import { exportConversationAsMarkdown } from '../../../services/session/manager';
import { shareTextExport } from '../../../services/share/localShare';
import type { Conversation, ConversationLogEntry } from '../../../types/conversation';
import { generateId } from '../../../utils/id';

type ConversationMode = 'agentic' | 'chitchat';

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
  ensureCanonicalConversation: (options: {
    mode?: ConversationMode;
    personaId?: string;
    reportMissingProvider?: boolean;
  }) => void;
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
  mode?: ConversationMode;
  personaId?: string;
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

      if (result.action === 'new_conversation') {
        params.actions.ensureCanonicalConversation({
          personaId: params.personaId,
          mode: params.mode,
          reportMissingProvider: true,
        });
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
        await shareTextExport({
          content: exportConversationAsMarkdown(conversation),
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
