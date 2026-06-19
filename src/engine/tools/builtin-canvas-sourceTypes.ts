export type CanvasToolExecutionContext = {
  conversationId?: string;
  readConversationFile?: (path: string) => Promise<string>;
  listConversationDirectory?: (
    path: string,
  ) => Promise<Array<{ path: string; kind: 'file' | 'directory' }>>;
};
