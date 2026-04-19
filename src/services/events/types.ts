// ---------------------------------------------------------------------------
// Kavi — Event Types
// ---------------------------------------------------------------------------

export type InternalHookEventType =
  | 'command'
  | 'session'
  | 'agent'
  | 'app'
  | 'mcp'
  | 'memory'
  | 'scheduler'
  | 'gateway'
  | 'canvas'
  | 'voice';

export interface InternalHookEvent {
  type: InternalHookEventType;
  action: string;
  sessionKey: string;
  context: Record<string, unknown>;
  timestamp: Date;
  messages: string[];
}

export type InternalHookHandler = (event: InternalHookEvent) => Promise<void> | void;

// Mobile-specific event types

export type AppLifecycleEvent = InternalHookEvent & {
  type: 'app';
  action: 'foreground' | 'background' | 'launch';
};

export type McpConnectionEvent = InternalHookEvent & {
  type: 'mcp';
  action: 'connected' | 'disconnected' | 'tool_added' | 'tool_removed' | 'error';
  context: {
    serverId: string;
    serverName?: string;
    toolName?: string;
    error?: string;
  };
};

export type SessionEvent = InternalHookEvent & {
  type: 'session';
  action: 'start' | 'end' | 'compacted' | 'idle' | 'reset';
  context: {
    conversationId?: string;
    reason?: string;
  };
};

export type MemoryEvent = InternalHookEvent & {
  type: 'memory';
  action: 'updated' | 'flushed' | 'searched';
  context: {
    conversationId?: string;
    source?: string;
  };
};

export type SchedulerEvent = InternalHookEvent & {
  type: 'scheduler';
  action: 'task_run' | 'task_complete' | 'task_failed' | 'task_created' | 'task_removed';
  context: {
    taskId?: string;
    taskName?: string;
    error?: string;
  };
};

export type CommandEvent = InternalHookEvent & {
  type: 'command';
  action: string;
  context: {
    commandName: string;
    args?: string;
    conversationId?: string;
  };
};

export type AgentEvent = InternalHookEvent & {
  type: 'agent';
  action: 'tool_start' | 'tool_end' | 'thinking' | 'responding' | 'done' | 'error';
  context: {
    conversationId?: string;
    toolName?: string;
    error?: string;
    iteration?: number;
  };
};

export type GatewayEvent = InternalHookEvent & {
  type: 'gateway';
  action: 'connected' | 'disconnected' | 'paired' | 'node_registered' | 'error';
  context: {
    gatewayUrl?: string;
    nodeId?: string;
    error?: string;
  };
};

export type CanvasEvent = InternalHookEvent & {
  type: 'canvas';
  action: 'surface_created' | 'surface_updated' | 'surface_deleted' | 'user_action';
  context: {
    surfaceId?: string;
    componentId?: string;
    actionType?: string;
  };
};

export type VoiceEvent = InternalHookEvent & {
  type: 'voice';
  action: 'started' | 'stopped' | 'transcript' | 'response' | 'error';
  context: {
    transcript?: string;
    error?: string;
  };
};
