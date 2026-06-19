import { normalizeToolName } from './toolNameNormalization';

const SESSION_COORDINATION_TOOL_NAMES = new Set([
  'sessions_spawn',
  'sessions_send',
  'sessions_wait',
  'sessions_cancel',
  'sessions_yield',
  'wait',
]);

const SESSION_INSPECTION_TOOL_NAMES = new Set([
  'sessions_status',
  'sessions_list',
  'sessions_history',
  'sessions_output',
  'sessions_surface_output',
]);

const SESSION_TOOL_NAMES = new Set([
  ...Array.from(SESSION_COORDINATION_TOOL_NAMES),
  ...Array.from(SESSION_INSPECTION_TOOL_NAMES),
]);

export function isSessionCoordinationToolName(name: string | undefined): boolean {
  return SESSION_COORDINATION_TOOL_NAMES.has(normalizeToolName(name || ''));
}

export function isSessionInspectionToolName(name: string | undefined): boolean {
  return SESSION_INSPECTION_TOOL_NAMES.has(normalizeToolName(name || ''));
}

export function isSessionToolName(name: string | undefined): boolean {
  return SESSION_TOOL_NAMES.has(normalizeToolName(name || ''));
}
