import type { ToolExecutionContext } from '../toolExecutionContext';

export type NativeToolExecutionRequest = {
  name: string;
  argsString: string;
  conversationId: string;
  context?: ToolExecutionContext;
};

export interface NativeToolExecutionEnvironment {
  tryExecute(request: NativeToolExecutionRequest): Promise<string | null>;
}

type NativeToolExecutionEnvironmentRegistration = {
  environment: NativeToolExecutionEnvironment;
};

let activeRegistration: NativeToolExecutionEnvironmentRegistration | null = null;

/**
 * Installs one process-scoped native execution environment.
 *
 * Production does not install an override. Acceptance and other isolated
 * runtimes must dispose their registration before another environment starts.
 */
export function installNativeToolExecutionEnvironment(
  environment: NativeToolExecutionEnvironment,
): () => void {
  if (activeRegistration) {
    throw new Error('A native tool execution environment is already installed.');
  }

  const registration = { environment };
  activeRegistration = registration;
  let disposed = false;

  return () => {
    if (disposed) return;
    disposed = true;
    if (activeRegistration === registration) {
      activeRegistration = null;
    }
  };
}

export async function tryExecuteNativeToolInEnvironment(
  request: NativeToolExecutionRequest,
): Promise<string | null> {
  return activeRegistration?.environment.tryExecute(request) ?? null;
}
