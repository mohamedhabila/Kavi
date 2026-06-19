import type { ToolExecutionContext } from './toolExecutionContext';
import type { createConversationFileContext } from './toolWorkspaceFiles';

export type BuiltinConversationFileContext = ReturnType<typeof createConversationFileContext>;

export interface BuiltinToolExecutionParams {
  name: string;
  args: any;
  conversationId: string;
  workspaceConversationId: string;
  conversationFileContext: BuiltinConversationFileContext;
  context?: ToolExecutionContext;
}
