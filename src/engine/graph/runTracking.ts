import type { Message } from '../../types/message';
import { filterModelVisibleAttachments } from '../../utils/messageAttachments';
import { getCommand } from '../../services/commands/builtins';
import { parseCommand } from '../../services/commands/parser';

export function isRegisteredSlashCommand(content: string | undefined): boolean {
  const command = parseCommand(content);
  return command ? getCommand(command.name) !== undefined : false;
}

/** Every foreground turn that acts is a tracked agent run; a slash command or an empty turn is not. */
export function shouldTrackForegroundAgentRun(params: {
  latestUserMessage?: Message;
  reuseAgentRunId?: string;
}): boolean {
  if (params.reuseAgentRunId?.trim()) {
    return true;
  }

  if (isRegisteredSlashCommand(params.latestUserMessage?.content)) {
    return false;
  }

  const attachmentCount =
    filterModelVisibleAttachments(params.latestUserMessage?.attachments)?.length ?? 0;
  return attachmentCount > 0 || (params.latestUserMessage?.content.trim().length ?? 0) > 0;
}
