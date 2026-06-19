export interface JsBridgeContext {
  workspaceId?: string;
  env?: Record<string, string>;
  fileCache?: Map<string, string>;
  workingDirectory?: string;
  argv?: string[];
  entryPath?: string;
}

export interface JavaScriptWorkspaceExecutionResult {
  result: unknown;
  fileCache: Map<string, string>;
  hadError: boolean;
}
