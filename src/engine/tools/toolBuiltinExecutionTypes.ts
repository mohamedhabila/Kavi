import type { ToolExecutionContext } from './toolExecutionContext';
import type { createConversationFileContext } from './toolWorkspaceFiles';
import type { AuthorizedToolEffectExecutionClaim } from '../../services/executionJournal/authorizedToolEffectExecutionClaim';

export type BuiltinConversationFileContext = ReturnType<typeof createConversationFileContext>;

export interface BuiltinToolExecutionParams {
  name: string;
  args: any;
  conversationId: string;
  workspaceConversationId: string;
  conversationFileContext: BuiltinConversationFileContext;
  context?: ToolExecutionContext;
  /** Persisted dispatch authority, routed only to code-owned builtin executors. */
  authorizedEffectExecutionClaim?: AuthorizedToolEffectExecutionClaim;
}
