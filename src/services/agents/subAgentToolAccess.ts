import { normalizeToolName } from '../../engine/tools/toolNameNormalization';
import {
  filterRuntimeAvailableToolNames,
  getRuntimeToolAvailabilityContext,
} from '../../engine/tools/runtimeAvailability';
import { hasExplicitToolConfiguration, normalizeConfiguredToolNames } from './lifecycle/runConfig';

function isDynamicToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__') || toolName.startsWith('skill__');
}

const SAFE_ONLY_TOOLS = new Set([
  'read_file',
  'list_files',
  'web_search',
  'web_fetch',
  'glob_search',
  'text_search',
  'memory_search',
  'javascript',
  'tool_catalog',
  'tool_describe',
  'canvas_list',
  'canvas_read',
  'canvas_snapshot',
  'sessions_list',
  'sessions_status',
  'sessions_history',
  'sessions_output',
  'sessions_surface_output',
  'sessions_wait',
  'wait',
  'workspace_status',
  'expo_eas_status',
  'expo_eas_probe',
  'expo_eas_workflow_runs',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
  'browser_snapshot',
  'browser_screenshot',
  'browser_console',
  'browser_errors',
  'browser_network',
  'browser_status',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_hover',
  'browser_select',
  'browser_wait',
  'browser_evaluate',
]);

export function isToolAllowedBySandbox(
  toolName: string,
  policy: 'full' | 'safe-only' | 'inherit',
  options?: { explicitlyAllowedTools?: ReadonlySet<string> | null },
): boolean {
  if (policy === 'full') return true;
  if (policy === 'safe-only') {
    if (SAFE_ONLY_TOOLS.has(toolName)) {
      return true;
    }

    if (isDynamicToolName(toolName)) {
      return options?.explicitlyAllowedTools?.has(toolName) === true;
    }

    return false;
  }
  return true;
}

export function resolveSubAgentToolAccess(params: {
  tools: unknown;
  sandboxPolicy: 'full' | 'safe-only' | 'inherit';
}): {
  hasExplicitToolsConfig: boolean;
  explicitToolSelectionRejectedMessage: string | undefined;
  disableToolingForExplicitEmptyToolSurface: boolean;
  toolFilter: ((name: string) => boolean) | undefined;
} {
  const runtimeToolAvailability = getRuntimeToolAvailabilityContext();
  const hasExplicitToolsConfig = hasExplicitToolConfiguration(params.tools);
  const requestedToolNames = normalizeConfiguredToolNames(params.tools);
  const configuredPreferredTools = filterRuntimeAvailableToolNames(
    requestedToolNames,
    runtimeToolAvailability,
  );
  const allowedToolNames: string[] | undefined = (() => {
    if (!configuredPreferredTools?.length) {
      return hasExplicitToolsConfig ? [] : undefined;
    }

    if (params.sandboxPolicy !== 'safe-only') {
      return configuredPreferredTools;
    }

    const explicitlyAllowedTools = new Set(configuredPreferredTools);
    return configuredPreferredTools.filter((toolName) =>
      isToolAllowedBySandbox(toolName, params.sandboxPolicy, {
        explicitlyAllowedTools,
      }),
    );
  })();

  const explicitToolSelectionRejectedMessage =
    !!requestedToolNames?.length && (allowedToolNames?.length ?? 0) === 0
      ? params.sandboxPolicy === 'safe-only'
        ? 'Worker launch rejected because the requested tools are not allowed by the safe-only sandbox. Choose safe tools or relax the sandbox policy.'
        : 'Worker launch rejected because none of the requested worker tools are currently available.'
      : undefined;

  const disableToolingForExplicitEmptyToolSurface =
    hasExplicitToolsConfig && (allowedToolNames?.length ?? 0) === 0;

  const toolFilter = (() => {
    const hasToolsWhitelist = hasExplicitToolsConfig;
    const hasSandboxRestriction = params.sandboxPolicy === 'safe-only';

    if (!hasToolsWhitelist && !hasSandboxRestriction) {
      return undefined;
    }

    const toolsSet = hasToolsWhitelist ? new Set(allowedToolNames ?? []) : null;
    return (name: string): boolean => {
      const normalizedName = normalizeToolName(name);
      if (toolsSet && !toolsSet.has(normalizedName)) return false;
      if (
        hasSandboxRestriction &&
        !isToolAllowedBySandbox(normalizedName, params.sandboxPolicy, {
          explicitlyAllowedTools: toolsSet,
        })
      ) {
        return false;
      }
      return true;
    };
  })();

  return {
    hasExplicitToolsConfig,
    explicitToolSelectionRejectedMessage,
    disableToolingForExplicitEmptyToolSurface,
    toolFilter,
  };
}
