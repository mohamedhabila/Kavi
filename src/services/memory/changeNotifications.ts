export interface MemoryChangeEvent {
  updatedAt: number;
  conversationId?: string;
}

type MemoryChangeListener = (event: MemoryChangeEvent) => void;

const memorySubscribers = new Set<MemoryChangeListener>();
let lastMemoryUpdatedAt: number | null = null;

export function notifyStructuredMemoryChanged(conversationId?: string | null): void {
  const event: MemoryChangeEvent = {
    updatedAt: Date.now(),
    ...(conversationId ? { conversationId } : {}),
  };
  lastMemoryUpdatedAt = event.updatedAt;
  memorySubscribers.forEach((listener) => listener(event));
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
