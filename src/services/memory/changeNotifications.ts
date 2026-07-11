export type MemoryChangeScope =
  | 'global'
  | 'conversation'
  | 'daily'
  | 'structured'
  | 'all';

export interface MemoryChangeEvent {
  scope: MemoryChangeScope;
  updatedAt: number;
  conversationId?: string;
}

type MemoryChangeListener = (event: MemoryChangeEvent) => void;

const memorySubscribers = new Set<MemoryChangeListener>();
let lastMemoryUpdatedAt: number | null = null;

export function notifyMemoryChanged(
  scope: MemoryChangeScope,
  conversationId?: string | null,
): void {
  const event: MemoryChangeEvent = {
    scope,
    updatedAt: Date.now(),
    ...(conversationId ? { conversationId } : {}),
  };
  lastMemoryUpdatedAt = event.updatedAt;
  memorySubscribers.forEach((listener) => listener(event));
}

export function notifyStructuredMemoryChanged(conversationId?: string | null): void {
  notifyMemoryChanged('structured', conversationId);
}

export function subscribeToMemoryChanges(listener: MemoryChangeListener): () => void {
  memorySubscribers.add(listener);
  return () => {
    memorySubscribers.delete(listener);
  };
}

export function getMemoryLastUpdatedAt(): number | null {
  return lastMemoryUpdatedAt;
}
