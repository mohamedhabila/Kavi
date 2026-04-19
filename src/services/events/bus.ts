// ---------------------------------------------------------------------------
// Kavi — Event Bus
// ---------------------------------------------------------------------------
// Uses globalThis singleton so that register and trigger always share the
// same Map even when the bundler emits multiple copies.

import type { InternalHookEvent, InternalHookEventType, InternalHookHandler } from './types';

export type { InternalHookHandler };

const _g = globalThis as typeof globalThis & {
  __kavi_internal_hook_handlers__?: Map<string, InternalHookHandler[]>;
};
const handlers = (_g.__kavi_internal_hook_handlers__ ??= new Map<string, InternalHookHandler[]>());

/**
 * Register a hook handler for a specific event type or event:action combination
 */
export function registerInternalHook(eventKey: string, handler: InternalHookHandler): void {
  if (!handlers.has(eventKey)) {
    handlers.set(eventKey, []);
  }
  handlers.get(eventKey)!.push(handler);
}

/**
 * Unregister a specific hook handler
 */
export function unregisterInternalHook(eventKey: string, handler: InternalHookHandler): void {
  const eventHandlers = handlers.get(eventKey);
  if (!eventHandlers) return;

  const index = eventHandlers.indexOf(handler);
  if (index !== -1) {
    eventHandlers.splice(index, 1);
  }
  if (eventHandlers.length === 0) {
    handlers.delete(eventKey);
  }
}

/**
 * Clear all registered hooks (useful for testing)
 */
export function clearInternalHooks(): void {
  handlers.clear();
}

/**
 * Get all registered event keys (useful for debugging)
 */
export function getRegisteredEventKeys(): string[] {
  return Array.from(handlers.keys());
}

/**
 * Trigger a hook event.
 * Calls all handlers registered for:
 * 1. The general event type (e.g., 'command')
 * 2. The specific event:action combination (e.g., 'command:new')
 */
export async function triggerInternalHook(event: InternalHookEvent): Promise<void> {
  const typeHandlers = handlers.get(event.type) ?? [];
  const specificHandlers = handlers.get(`${event.type}:${event.action}`) ?? [];
  const allHandlers = [...typeHandlers, ...specificHandlers];

  if (allHandlers.length === 0) return;

  for (const handler of allHandlers) {
    try {
      await handler(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[EventBus] Hook error [${event.type}:${event.action}]: ${message}`);
    }
  }
}

/**
 * Create a hook event with common fields filled in
 */
export function createInternalHookEvent(
  type: InternalHookEventType,
  action: string,
  sessionKey: string,
  context: Record<string, unknown> = {},
): InternalHookEvent {
  return {
    type,
    action,
    sessionKey,
    context,
    timestamp: new Date(),
    messages: [],
  };
}

// Convenience emitters for common mobile events

export function emitAppEvent(action: 'foreground' | 'background' | 'launch'): Promise<void> {
  return triggerInternalHook(createInternalHookEvent('app', action, 'system'));
}

export function emitMcpEvent(
  action: 'connected' | 'disconnected' | 'tool_added' | 'tool_removed' | 'error',
  context: { serverId: string; serverName?: string; toolName?: string; error?: string },
): Promise<void> {
  return triggerInternalHook(createInternalHookEvent('mcp', action, 'system', context));
}

export function emitSessionEvent(
  action: 'start' | 'end' | 'compacted' | 'idle' | 'reset',
  context: { conversationId?: string; reason?: string } = {},
): Promise<void> {
  return triggerInternalHook(
    createInternalHookEvent('session', action, context.conversationId ?? 'system', context),
  );
}

export function emitAgentEvent(
  action: 'tool_start' | 'tool_end' | 'thinking' | 'responding' | 'done' | 'error',
  context: { conversationId?: string; toolName?: string; error?: string; iteration?: number } = {},
): Promise<void> {
  return triggerInternalHook(
    createInternalHookEvent('agent', action, context.conversationId ?? 'system', context),
  );
}

export function emitMemoryEvent(
  action: 'updated' | 'flushed' | 'searched',
  context: { conversationId?: string; source?: string } = {},
): Promise<void> {
  return triggerInternalHook(
    createInternalHookEvent('memory', action, context.conversationId ?? 'system', context),
  );
}

export function emitSchedulerEvent(
  action: 'task_run' | 'task_complete' | 'task_failed' | 'task_created' | 'task_removed',
  context: { taskId?: string; taskName?: string; error?: string } = {},
): Promise<void> {
  return triggerInternalHook(createInternalHookEvent('scheduler', action, 'system', context));
}

export function emitGatewayEvent(
  action: 'connected' | 'disconnected' | 'paired' | 'node_registered' | 'error',
  context: { gatewayUrl?: string; nodeId?: string; error?: string } = {},
): Promise<void> {
  return triggerInternalHook(createInternalHookEvent('gateway', action, 'system', context));
}

export function emitCanvasEvent(
  action: 'surface_created' | 'surface_updated' | 'surface_deleted' | 'user_action',
  context: { surfaceId?: string; componentId?: string; actionType?: string } = {},
): Promise<void> {
  return triggerInternalHook(createInternalHookEvent('canvas', action, 'system', context));
}

export function emitVoiceEvent(
  action: 'started' | 'stopped' | 'transcript' | 'response' | 'error',
  context: { transcript?: string; error?: string } = {},
): Promise<void> {
  return triggerInternalHook(createInternalHookEvent('voice', action, 'system', context));
}
