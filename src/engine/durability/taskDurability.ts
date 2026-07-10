export const TASK_DURABILITY_CLASSES = [
  'foreground_interactive',
  'user_initiated_continuable',
  'deferrable_maintenance',
  'event_driven_monitor',
  'external_durable_operation',
] as const;

export type TaskDurabilityClass = (typeof TASK_DURABILITY_CLASSES)[number];

import {
  qualifyExecutionExternalHandleLocator,
  type ExecutionExternalHandleLocator,
} from '../../services/executionJournal/externalLocators';

export type ExternalDurableHandle = ExecutionExternalHandleLocator & {
  sourceToolName: string;
};

export type CurrentTaskDurabilityClassification =
  | {
      taskClass: 'foreground_interactive';
      localExecution: 'process_bound';
      recovery: 'not_resumable';
    }
  | {
      taskClass: 'external_durable_operation';
      localExecution: 'process_bound';
      recovery: 'reconcile_external_handle';
      externalHandle: ExternalDurableHandle;
    };

const EXPO_WORKFLOW_HANDLE_SOURCES = new Set([
  'expo_eas_build',
  'expo_eas_update',
  'expo_eas_submit',
  'expo_eas_deploy_web',
  'expo_eas_workflow_runs',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
]);

const GITHUB_WORKFLOW_HANDLE_SOURCES = new Set([
  'skill__github__workflow_runs',
  'skill__github__checks_status',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeExactString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value !== value.trim()) {
    return null;
  }
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  return value;
}

/**
 * Turn an explicitly selected workflow run into a durable locator. This does
 * not select "latest" from a list and does not accept process-local session or
 * SSH job ids. Callers must choose one concrete run returned by the code-owned
 * Expo or GitHub integration before qualification.
 */
export function qualifyExternalDurableHandle(candidate: unknown): ExternalDurableHandle | null {
  if (!isRecord(candidate) || candidate.version !== 1) {
    return null;
  }

  const sourceToolName = normalizeExactString(candidate.sourceToolName, 120) ?? '';
  const locator = qualifyExecutionExternalHandleLocator(candidate);
  if (!locator) {
    return null;
  }

  if (locator.kind === 'expo_workflow_run') {
    if (!EXPO_WORKFLOW_HANDLE_SOURCES.has(sourceToolName)) {
      return null;
    }
    return { ...locator, sourceToolName };
  }

  if (locator.kind === 'github_workflow_run') {
    if (!GITHUB_WORKFLOW_HANDLE_SOURCES.has(sourceToolName)) {
      return null;
    }
    return { ...locator, sourceToolName };
  }

  return null;
}

/**
 * Local tool work remains process-bound. A concrete cloud workflow is externally
 * durable because the remote operation survives; journal recovery reconciles its
 * exact remote handle instead of pretending the interrupted local call can resume.
 */
export function classifyCurrentToolTaskDurability(input: {
  toolName: string;
  externalHandle?: unknown;
}): CurrentTaskDurabilityClassification {
  const toolName = input.toolName.trim();
  const externalHandle = qualifyExternalDurableHandle(input.externalHandle);
  if (externalHandle?.sourceToolName === toolName) {
    return {
      taskClass: 'external_durable_operation',
      localExecution: 'process_bound',
      recovery: 'reconcile_external_handle',
      externalHandle,
    };
  }

  return {
    taskClass: 'foreground_interactive',
    localExecution: 'process_bound',
    recovery: 'not_resumable',
  };
}
