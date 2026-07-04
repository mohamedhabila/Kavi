export async function readGlobalMemory(): Promise<string | null> {
  return null;
}

export async function readConversationMemory(_conversationId: string): Promise<string | null> {
  return null;
}

export function listDailyMemoryFiles(): string[] {
  return [];
}

export async function readDailyMemory(_dateStr: string): Promise<string | null> {
  return null;
}

export function notifyStructuredMemoryChanged(_conversationId?: string): void {}
