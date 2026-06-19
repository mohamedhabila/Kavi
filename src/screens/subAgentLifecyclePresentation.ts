type SubAgentEvent = 'started' | 'completed' | 'timeout' | 'error' | 'cancelled' | 'progress';

export function getSubAgentLifecycleLogLevel(
  event: SubAgentEvent,
): 'info' | 'success' | 'warning' | 'error' {
  if (event === 'started') {
    return 'info';
  }
  if (event === 'completed') {
    return 'success';
  }
  if (event === 'cancelled' || event === 'timeout') {
    return 'warning';
  }
  return 'error';
}

export function getSubAgentLifecycleTitle(event: SubAgentEvent, label: string): string {
  if (event === 'started') {
    return `Sub-agent ${label} spawned`;
  }
  if (event === 'completed') {
    return `Sub-agent ${label} completed`;
  }
  if (event === 'timeout') {
    return `Sub-agent ${label} timed out`;
  }
  if (event === 'cancelled') {
    return `Sub-agent ${label} cancelled`;
  }
  return `Sub-agent ${label} failed`;
}

export function getSubAgentCheckpointTitle(event: SubAgentEvent, label: string): string {
  if (event === 'started') {
    return `Worker started: ${label}`;
  }
  if (event === 'completed') {
    return `Worker completed: ${label}`;
  }
  if (event === 'timeout') {
    return `Worker timed out: ${label}`;
  }
  if (event === 'cancelled') {
    return `Worker cancelled: ${label}`;
  }
  return `Worker failed: ${label}`;
}
