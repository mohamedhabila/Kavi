import { composeActiveFocusContent } from './focus';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { refreshThreadReflection } from './reflections';
import { editPromptEligibleWorkingBlock, getWorkingBlock } from './workingBlocks';

function preserveThreadTitleFocus(input: {
  memoryConversationId: string;
  threadTitle?: string;
  now: number;
}): boolean {
  const threadId = input.memoryConversationId;
  const threadTitle = input.threadTitle?.trim();
  if (!isExactMemoryScopeId(threadId) || !threadTitle) {
    return false;
  }

  const scope = { conversationId: threadId, threadId };
  const existing = getWorkingBlock('active_focus', scope)?.content;
  const content = composeActiveFocusContent({
    threadTitle,
    activeFocus: existing,
  });
  if (content && content !== existing?.trim()) {
    editPromptEligibleWorkingBlock('active_focus', content, scope, { now: input.now });
    return true;
  }
  return false;
}

export function commitPostIngestionDurableState(input: {
  memoryConversationId: string;
  threadTitle?: string;
  taskId: string | null;
  sourceAt: number;
  now: number;
}): Readonly<{ activeFocusUpdated: boolean }> {
  const activeFocusUpdated = preserveThreadTitleFocus(input);
  refreshThreadReflection({
    threadId: input.memoryConversationId,
    taskId: input.taskId,
    periodAt: input.sourceAt,
    now: input.now,
  });
  return { activeFocusUpdated };
}
