// ---------------------------------------------------------------------------
// Kavi — Tool Manager
// ---------------------------------------------------------------------------
// Implements tiered tool selection, provider-aware limits, token budgeting,
// and dynamic tool discovery. Addresses three critical issues:
//   1. OpenAI 128-tool limit (Error 400 when >128 tools)
//   2. Token optimization (compress/defer low-frequency tools)
//   3. Context budget enforcement (tools contribute to prompt token count)
//
// Based on OpenAI's tool_search pattern and Anthropic's defer_loading design.
// References:
//   - https://developers.openai.com/api/docs/guides/function-calling
//   - https://www.anthropic.com/engineering/advanced-tool-use

import { LlmProviderKind, ToolDefinition } from '../../types';
import { estimateTokens } from '../../services/context/tokenCounter';

// ── Provider tool limits ─────────────────────────────────────────────────

export const PROVIDER_TOOL_LIMITS: Record<string, number> = {
  openai: 128,
  anthropic: 64, // aggregate schema complexity limit is lower than array-count limit
  openrouter: 128, // proxied to OpenAI models often
  ollama: 64, // local models are more constrained
  gemini: 20, // Google recommends 10-20 tools max for best function calling
  'on-device': 12, // keep LiteRT-LM tool schemas narrow to avoid prompt/prefill blowups
  default: 128,
};

export const ON_DEVICE_TOOL_TOKEN_BUDGET = 1800;

export type ToolProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'openrouter'
  | 'on-device'
  | 'default';

function isAnthropicToolProvider(providerName: string, baseUrl?: string): boolean {
  const lower = (providerName || '').toLowerCase();
  const url = (baseUrl || '').toLowerCase();
  return url.includes('anthropic.com') || lower.includes('anthropic');
}

function isGeminiToolProvider(providerName: string, baseUrl?: string): boolean {
  const lower = (providerName || '').toLowerCase();
  const url = (baseUrl || '').toLowerCase();
  return url.includes('googleapis.com') || lower.includes('gemini') || lower.includes('google');
}

function isOnDeviceToolProvider(
  providerName: string,
  baseUrl?: string,
  providerKind?: LlmProviderKind,
): boolean {
  if (providerKind === 'on-device') {
    return true;
  }

  const lower = (providerName || '').toLowerCase();
  const url = (baseUrl || '').trim().toLowerCase();
  if (url.length > 0) {
    return false;
  }

  return lower.includes('on-device') || lower.includes('on device') || lower.includes('ondevice');
}

function detectModelToolFamily(model?: string): ToolProviderFamily | null {
  const lower = (model || '').toLowerCase().trim();
  if (!lower) {
    return null;
  }

  if (lower.includes('gemini') || lower.startsWith('google/')) {
    return 'gemini';
  }

  if (lower.includes('claude') || lower.startsWith('anthropic/')) {
    return 'anthropic';
  }

  if (
    lower.startsWith('openai/') ||
    lower.includes('gpt-') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4')
  ) {
    return 'openai';
  }

  if (lower.includes('ollama')) {
    return 'ollama';
  }

  return null;
}

export function resolveToolProviderFamily(
  providerName: string,
  baseUrl?: string,
  model?: string,
  providerKind?: LlmProviderKind,
): ToolProviderFamily {
  const lower = (providerName || '').toLowerCase();
  const url = (baseUrl || '').toLowerCase();
  const modelFamily = detectModelToolFamily(model);

  if (isOnDeviceToolProvider(providerName, baseUrl, providerKind)) return 'on-device';
  if (isAnthropicToolProvider(providerName, baseUrl)) return 'anthropic';
  if (isGeminiToolProvider(providerName, baseUrl)) return 'gemini';
  if (lower.includes('ollama')) return 'ollama';

  if (url.includes('openrouter.ai') || lower.includes('openrouter')) {
    return modelFamily ?? 'openrouter';
  }

  if (url.includes('openai.com') || lower.includes('openai')) {
    return 'openai';
  }

  if (modelFamily) {
    return modelFamily;
  }

  return (PROVIDER_TOOL_LIMITS[lower] ? lower : 'default') as ToolProviderFamily;
}

/**
 * Resolve the tool array limit for a provider.
 */
export function getProviderToolLimit(
  providerName: string,
  baseUrl?: string,
  model?: string,
  providerKind?: LlmProviderKind,
): number {
  const family = resolveToolProviderFamily(providerName, baseUrl, model, providerKind);

  return PROVIDER_TOOL_LIMITS[family] ?? PROVIDER_TOOL_LIMITS.default;
}

// ── Tool tiers ───────────────────────────────────────────────────────────
// Tier 1 — Always loaded: fundamental tools used in almost every conversation.
// Tier 2 — On-demand: loaded when user message content signals relevance.
// All MCP + Skill tools are Tier 2 by default.

export const TIER1_TOOL_NAMES = new Set([
  // Core workspace
  'read_file',
  'write_file',
  'list_files',
  'fetch_url',
  'javascript',
  'update_memory',
  'read_memory',
  'record_workflow_evidence',
  'read_workflow_evidence',
  'create_task',
  // Extended essentials
  'file_edit',
  'glob_search',
  'text_search',
  'web_search',
  'web_fetch',
  // Meta
  'tool_catalog',
]);

const GEMINI_ALWAYS_LOADED_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'list_files',
  'fetch_url',
  'record_workflow_evidence',
  'read_workflow_evidence',
  'file_edit',
  'glob_search',
  'text_search',
  'web_search',
  'tool_catalog',
]);

export const ON_DEVICE_ALWAYS_LOADED_TOOL_NAMES = new Set([
  'read_file',
  'list_files',
  'fetch_url',
  'file_edit',
  'glob_search',
  'text_search',
  'web_search',
  'tool_catalog',
]);

const ANTHROPIC_ALWAYS_LOADED_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'list_files',
  'javascript',
  'update_memory',
  'read_memory',
  'record_workflow_evidence',
  'read_workflow_evidence',
  'create_task',
  'file_edit',
  'tool_catalog',
]);

function getAlwaysLoadedToolNames(
  providerName: string,
  baseUrl?: string,
  model?: string,
  providerKind?: LlmProviderKind,
): ReadonlySet<string> {
  const family = resolveToolProviderFamily(providerName, baseUrl, model, providerKind);

  if (family === 'anthropic') {
    return ANTHROPIC_ALWAYS_LOADED_TOOL_NAMES;
  }

  if (family === 'on-device') {
    // LiteRT-LM pre-fills tool declarations into conversation creation, so
    // keep the first pass discovery-first and let tool_catalog unlock the rest.
    return ON_DEVICE_ALWAYS_LOADED_TOOL_NAMES;
  }

  if (family === 'gemini') {
    // Gemini has a much smaller effective tool budget, so keep a lean base
    // set and leave room for discovered tools.
    return GEMINI_ALWAYS_LOADED_TOOL_NAMES;
  }

  return TIER1_TOOL_NAMES;
}

const SUPER_AGENT_CORE_TOOL_NAMES = new Set([
  'sessions_spawn',
  'sessions_list',
  'sessions_output',
  'sessions_surface_output',
  'sessions_status',
  'sessions_wait',
  'sessions_cancel',
  'sessions_yield',
  'wait',
]);

/**
 * Category keywords: if the user message matches any keyword, the category's
 * tools are promoted from Tier 2 to available.
 */
export interface ToolCategory {
  name: string;
  toolNames: string[];
  keywords: RegExp;
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'workspace_search',
    toolNames: ['glob_search', 'text_search'],
    keywords:
      /search|find|grep|glob|pattern|match|where|which file|contains|workspace|project|repo|repository|codebase|source|function|class|symbol|file|files/i,
  },
  {
    name: 'code',
    toolNames: ['javascript', 'python'],
    keywords:
      /\b(python|pyodide|micropip|numpy|pandas|scipy|regex|encode|decode|calculate|compute|docx|xlsx|pptx|csv|xml|json|yaml|zip|archive)\b|regular expression|(?:run|execute)\s+(?:code|script|python|javascript)|(?:generate|create|convert|export|assemble)\s+(?:a\s+|an\s+|this\s+|the\s+)?(?:docx|xlsx|pptx|csv|json|xml|yaml|report|artifact|archive|zip)(?:\b|\s)|(?:transform|parse|sort|convert|export|generate|assemble)\s+(?:this\s+)?(?:json|csv|xml|yaml|data|text|array|list|table|report|docx|xlsx|pptx|archive|zip)/i,
  },
  {
    name: 'web_research',
    toolNames: ['fetch_url', 'web_search', 'web_fetch'],
    keywords:
      /web|internet|online|url|link|website|page|look up|lookup|latest|current|news|fetch|search online|search the web|http/i,
  },
  {
    name: 'browser',
    toolNames: [
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_press_key',
      'browser_hover',
      'browser_select',
      'browser_drag',
      'browser_wait',
      'browser_screenshot',
      'browser_snapshot',
      'browser_console',
      'browser_errors',
      'browser_network',
      'browser_cookies',
      'browser_storage',
      'browser_launch',
      'browser_stop',
      'browser_status',
      'browser_evaluate',
    ],
    keywords: /browser|webpage|website|html|click|navigate|screenshot|scrape|automat/i,
  },
  {
    name: 'canvas',
    toolNames: [
      'canvas_create',
      'canvas_read',
      'canvas_update',
      'canvas_delete',
      'canvas_navigate',
      'canvas_eval',
      'canvas_snapshot',
      'canvas_list',
    ],
    keywords: /canvas|surface|dashboard|widget|interactive|render|component/i,
  },
  {
    name: 'ssh',
    toolNames: [
      'ssh_exec',
      'ssh_background_job_status',
      'ssh_background_job_wait',
      'ssh_list_directory',
      'ssh_read_file',
      'ssh_write_file',
      'ssh_rename_path',
      'ssh_delete_path',
      'ssh_make_directory',
    ],
    keywords: /ssh|remote\s*server|sftp|terminal|shell|command.*remote|deploy|server.*connect/i,
  },
  {
    name: 'calendar',
    toolNames: ['calendar_list', 'calendar_events', 'calendar_create_event'],
    keywords: /calendar|event|schedule|meeting|appointment|remind/i,
  },
  {
    name: 'contacts',
    toolNames: [
      'contacts_pick',
      'contacts_manage_access',
      'contacts_view',
      'contacts_edit',
      'contacts_create',
      'contacts_share',
      'contacts_search_full',
      'contacts_get_full',
    ],
    keywords: /contact|phone.*number|email.*address|people|person/i,
  },
  {
    name: 'expo',
    toolNames: [
      'expo_eas_create_project',
      'expo_eas_list_projects',
      'expo_eas_status',
      'expo_eas_probe',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
      'expo_eas_graphql',
    ],
    keywords:
      /expo|eas|\.eas\/workflows|workflow|hosting|over.the.air|ota|update channel|deploy.*expo|expo.*deploy/i,
  },
  {
    name: 'expo_manual_actions',
    toolNames: ['expo_eas_build', 'expo_eas_update', 'expo_eas_submit', 'expo_eas_deploy_web'],
    keywords:
      /\b(eas (build|update|submit|workflow:run)|expo_eas_(build|update|submit|deploy_web)|manual(ly)? .* (build|update|submit|deploy)|re-?run .* (workflow|build|update|submit|deploy)|trigger .* (workflow|build|update|submit|deploy)|dispatch .* (workflow|build|update|submit|deploy)|without commit|no commit|build now|deploy now|submit now|update now)\b/i,
  },
  {
    name: 'sessions',
    toolNames: [
      'sessions_spawn',
      'sessions_list',
      'sessions_send',
      'sessions_history',
      'sessions_output',
      'sessions_surface_output',
      'sessions_status',
      'sessions_wait',
      'sessions_cancel',
      'sessions_yield',
      'wait',
    ],
    keywords: /session|sub.?agent|parallel.*agent|spawn|multi.?agent/i,
  },
  {
    name: 'agents',
    toolNames: ['agents_list', 'agents_switch', 'agents_configure'],
    keywords: /agent|persona|switch.*agent|configure.*agent/i,
  },
  {
    name: 'media',
    toolNames: [
      'camera_snap',
      'camera_clip',
      'screen_record',
      'photos_latest',
      'audio_transcribe',
      'image_generate',
      'image_edit',
    ],
    keywords:
      /photo|camera|picture|image|screenshot|record|video|transcri|generat.*image|edit.*image|image.*edit|retouch|mask|background/i,
  },
  {
    name: 'device',
    toolNames: [
      'device_status',
      'device_info',
      'device_permissions',
      'device_health',
      'location_current',
      'haptic_feedback',
    ],
    keywords: /device|battery|storage|permission|location|gps|haptic/i,
  },
  {
    name: 'communication',
    toolNames: [
      'email_compose',
      'sms_compose',
      'phone_call',
      'maps_open',
      'share_text',
      'share_url',
      'share_file',
      'share_contact',
      'notification_send',
      'notification_schedule',
      'notify',
      'clipboard_read',
      'clipboard_write',
      'speak',
      'open_url',
      'poll_create',
      'message_effect',
    ],
    keywords:
      /email|mail|sms|text\s+message|call|dial|map|navigate|share|notification|clipboard|copy|paste|speak|say|open.*url|poll|vote/i,
  },
  {
    name: 'workspace_files',
    toolNames: [
      'workspace_status',
      'workspace_launch_browser',
      'workspace_delegate_task',
      'workspace_list_files',
      'workspace_read_file',
      'workspace_write_file',
      'workspace_mkdir',
      'workspace_rename',
      'workspace_delete',
    ],
    keywords:
      /remote workspace|workspace (?:target|server|folder|file|files|ide|chat)|external workspace|code-server|openvscode(?:-server)?|vscode(?:\.dev| web| tunnel)?|remote tunnel|cursor (?:ide|editor|agent|cli)|windsurf|antigravity|remote ide|ai ide|delegate .* workspace|control .* workspace|save .* workspace|write .* workspace/i,
  },
  {
    name: 'pdf',
    toolNames: ['pdf_read'],
    keywords: /pdf|document|read.*pdf/i,
  },
  {
    name: 'cron',
    toolNames: ['cron'],
    keywords: /cron|schedule.*task|recurring|periodic/i,
  },
  {
    name: 'memory_search',
    toolNames: ['memory_search'],
    keywords: /memory.*search|search.*memory|remember|recall/i,
  },
];

// ── Message-based tool relevance detection ───────────────────────────────

/**
 * Scan the recent user messages to detect which tool categories are relevant.
 * Returns the set of category names that matched.
 */
export function detectRelevantCategories(recentUserMessages: string[]): Set<string> {
  const joined = recentUserMessages.join(' ');
  const matched = new Set<string>();
  for (const cat of TOOL_CATEGORIES) {
    if (cat.keywords.test(joined)) {
      matched.add(cat.name);
    }
  }
  return matched;
}

/**
 * Given the full tool array and the user context, select tools that should be
 * sent to the LLM. Implements:
 *   - Tier 1 tools always included
 *   - Tier 2 tools included if their category keywords match user messages
 *   - Explicitly discovered tools promoted into the active set
 *   - MCP/Skill tools stay deferred until discovery identifies the exact tool
 *   - If the result still exceeds the provider limit, trim the lowest-priority
 *     tools (by estimated token cost, heaviest first).
 */
export interface ToolSelectionOptions {
  model?: string;
  providerKind?: LlmProviderKind;
  discoveredCategories?: Iterable<string>;
  discoveredToolNames?: Iterable<string>;
  recentToolNames?: Iterable<string>;
  preferredToolNames?: Iterable<string>;
  restrictToPreferredTools?: boolean;
  allowDeferredBackfill?: boolean;
  /** When true, forces session/agent tool categories into the active set. */
  isSuperAgent?: boolean;
}

export function selectToolsForRequest(
  allTools: ToolDefinition[],
  userMessages: string[],
  providerName: string,
  providerBaseUrl?: string,
  tokenBudget?: number,
  options?: ToolSelectionOptions,
): ToolDefinition[] {
  const dedupedTools = Array.from(new Map(allTools.map((tool) => [tool.name, tool])).values());
  const limit = getProviderToolLimit(
    providerName,
    providerBaseUrl,
    options?.model,
    options?.providerKind,
  );
  const providerFamily = resolveToolProviderFamily(
    providerName,
    providerBaseUrl,
    options?.model,
    options?.providerKind,
  );
  const geminiTarget = providerFamily === 'gemini';
  const onDeviceTarget = providerFamily === 'on-device';
  const relevantCategories = new Set(detectRelevantCategories(userMessages));
  const discoveredToolNames = new Set(
    Array.from(options?.discoveredToolNames ?? []).filter(Boolean),
  );
  const recentToolNames = new Set(Array.from(options?.recentToolNames ?? []).filter(Boolean));
  const preferredToolNames = new Set(Array.from(options?.preferredToolNames ?? []).filter(Boolean));
  const restrictToPreferredTools =
    preferredToolNames.size > 0 && options?.restrictToPreferredTools === true;
  for (const category of options?.discoveredCategories ?? []) {
    if (category) {
      relevantCategories.add(category);
    }
  }
  // SuperAgent mode: always include session orchestration tools so the LLM
  // can autonomously decide to spawn sub-agents without user keyword hints.
  if (options?.isSuperAgent) {
    relevantCategories.add('sessions');
    relevantCategories.add('agents');
  }
  // SuperAgent: keep the core supervision loop available even when the active
  // tool set is narrowed aggressively, but allow lower-priority session and
  // agent-management tools to be trimmed on constrained providers like Gemini.
  const superAgentForceInclude = options?.isSuperAgent
    ? new Set(SUPER_AGENT_CORE_TOOL_NAMES)
    : new Set<string>();
  const shouldBackfillDeferredTools = options?.allowDeferredBackfill === true;
  const alwaysLoadedToolNames = getAlwaysLoadedToolNames(
    providerName,
    providerBaseUrl,
    options?.model,
    options?.providerKind,
  );
  const noBackfillToolNames = new Set([
    'expo_eas_build',
    'expo_eas_update',
    'expo_eas_submit',
    'expo_eas_deploy_web',
  ]);
  const originalOrder = new Map(dedupedTools.map((tool, index) => [tool.name, index]));

  // Build category → toolNames lookup (inverted index)
  const toolToCategory = new Map<string, string>();
  for (const cat of TOOL_CATEGORIES) {
    for (const name of cat.toolNames) {
      toolToCategory.set(name, cat.name);
    }
  }

  // Partition tools into included and deferred
  const included: ToolDefinition[] = [];
  const deferred: ToolDefinition[] = [];

  for (const tool of dedupedTools) {
    const isTier1 = alwaysLoadedToolNames.has(tool.name);
    const isDiscoveredTool = discoveredToolNames.has(tool.name);
    const isRecentTool = recentToolNames.has(tool.name);
    const isPreferredTool = preferredToolNames.has(tool.name);
    const isSuperAgentEssential = superAgentForceInclude.has(tool.name);

    if (isTier1 || isPreferredTool || isSuperAgentEssential) {
      included.push(tool);
      continue;
    }

    if (restrictToPreferredTools && isDiscoveredTool) {
      included.push(tool);
      continue;
    }

    if (!restrictToPreferredTools && (isDiscoveredTool || isRecentTool)) {
      included.push(tool);
      continue;
    }

    if (restrictToPreferredTools) {
      deferred.push(tool);
      continue;
    }

    const category = toolToCategory.get(tool.name);
    if (category && relevantCategories.has(category)) {
      if (onDeviceTarget) {
        deferred.push(tool);
        continue;
      }

      included.push(tool);
      continue;
    }

    // Not tier1, not matched category → defer
    deferred.push(tool);
  }

  // Anthropic renders tool definitions into the system-prompt prefix and has a
  // much tighter strict-schema budget. Avoid backfilling unrelated tools just
  // because spare capacity exists; let tool_catalog advertise the rest.
  if (shouldBackfillDeferredTools && included.length < limit) {
    // Add deferred tools up to the limit, prioritising smaller ones
    const sorted = deferred
      .filter((tool) => !noBackfillToolNames.has(tool.name))
      .sort((a, b) => estimateToolTokens(a) - estimateToolTokens(b));
    for (const tool of sorted) {
      if (included.length >= limit) break;
      included.push(tool);
    }
  }

  // Enforce hard limit — trim heaviest tools first
  if (included.length > limit) {
    // Sort by priority: Tier1 first (weight 0), exact discovered tools
    // second (weight 1), category-matched tools third (weight 2), others last.
    const weight = (t: ToolDefinition): number => {
      if (alwaysLoadedToolNames.has(t.name)) return 0;
      if (superAgentForceInclude.has(t.name)) return 0;
      if (preferredToolNames.has(t.name)) return 1;
      if (discoveredToolNames.has(t.name)) return 2;
      if (recentToolNames.has(t.name)) return 2;
      const cat = toolToCategory.get(t.name);
      if (cat && relevantCategories.has(cat)) return 2;
      return 3;
    };

    included.sort((a, b) => {
      const wDiff = weight(a) - weight(b);
      if (wDiff !== 0) return wDiff;
      if (geminiTarget || onDeviceTarget) {
        return (
          (originalOrder.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
          (originalOrder.get(b.name) ?? Number.MAX_SAFE_INTEGER)
        );
      }
      // Same weight → prefer smaller token footprint
      return estimateToolTokens(a) - estimateToolTokens(b);
    });

    included.length = limit;
  }

  // Apply token budget if specified
  if (tokenBudget && tokenBudget > 0) {
    const pinnedToolNames = new Set<string>(recentToolNames);
    for (const name of preferredToolNames) {
      pinnedToolNames.add(name);
    }
    if (restrictToPreferredTools) {
      for (const name of discoveredToolNames) {
        pinnedToolNames.add(name);
      }
    }

    return enforceToolTokenBudget(included, tokenBudget, {
      pinnedToolNames,
    });
  }

  return included;
}

// ── Tool token estimation ────────────────────────────────────────────────

/**
 * Estimate the token cost of a single tool definition as it would appear in
 * the API request (name + description + JSON schema).
 */
export function estimateToolTokens(tool: ToolDefinition): number {
  const nameTokens = estimateTokens(tool.name);
  const descTokens = estimateTokens(tool.description || '');
  const schemaTokens = estimateTokens(JSON.stringify(tool.input_schema || {}));
  // ~10 tokens overhead for JSON framing (type, name, description keys, etc.)
  return nameTokens + descTokens + schemaTokens + 10;
}

/**
 * Estimate total tokens consumed by an array of tool definitions.
 */
export function estimateAllToolTokens(tools: ToolDefinition[]): number {
  let total = 0;
  for (const tool of tools) {
    total += estimateToolTokens(tool);
  }
  return total;
}

// ── Tool token budget enforcement ────────────────────────────────────────

/**
 * If total tool tokens exceed the budget, progressively drop the lowest-priority
 * (heaviest, non-Tier-1) tools until within budget.
 */
export interface EnforceToolTokenBudgetOptions {
  pinnedToolNames?: Iterable<string>;
}

export function enforceToolTokenBudget(
  tools: ToolDefinition[],
  budgetTokens: number,
  options?: EnforceToolTokenBudgetOptions,
): ToolDefinition[] {
  let total = estimateAllToolTokens(tools);
  if (total <= budgetTokens) return tools;
  const pinnedToolNames = new Set(Array.from(options?.pinnedToolNames ?? []).filter(Boolean));

  // Sort: keep Tier1 and pinned continuation tools first, then MCP/Skill tools,
  // then other tools. Drop the heaviest non-essential tools last.
  const scored = tools.map((t) => ({
    tool: t,
    priority: TIER1_TOOL_NAMES.has(t.name)
      ? 0
      : pinnedToolNames.has(t.name)
        ? 1
        : t.name.startsWith('mcp__') || t.name.startsWith('skill__')
          ? 2
          : 3,
    tokens: estimateToolTokens(t),
  }));

  // Remove from the back of priority (highest priority number + most tokens)
  scored.sort((a, b) => {
    const pd = a.priority - b.priority;
    if (pd !== 0) return pd;
    return a.tokens - b.tokens; // smaller first (we trim from end)
  });

  while (total > budgetTokens && scored.length > 0) {
    const last = scored[scored.length - 1];
    // Never remove Tier1 or explicitly pinned continuation tools.
    if (last.priority <= 1) break;
    scored.pop();
    total -= last.tokens;
  }

  return scored.map((s) => s.tool);
}

// ── Tool description compression ─────────────────────────────────────────

/**
 * Compress a tool definition's description to save tokens.
 * Removes redundant phrasing, trailing guidance, and verbose explanations.
 * Keeps the first sentence and key constraints.
 */
export function compressToolDescription(description: string): string {
  if (!description) return '';

  // Take only the first two sentences — typically enough
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return description;

  // Keep first two sentences which usually cover the what and key constraint
  return sentences.slice(0, 2).join(' ');
}

/**
 * Return a compressed copy of tool definitions to reduce token overhead.
 * Used for Tier 2 tools that need to be included but can have shorter descriptions.
 */
export function compressToolDefinitions(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => {
    if (TIER1_TOOL_NAMES.has(tool.name)) {
      // Keep Tier 1 descriptions intact — they're the most-used
      return tool;
    }
    return {
      ...tool,
      description: compressToolDescription(tool.description),
    };
  });
}

function formatDeferredCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    workspace_search: 'Workspace search',
    code: 'Code / computation',
    web_research: 'Web research',
    browser: 'Browser automation',
    canvas: 'Canvas previews',
    ssh: 'SSH / remote access',
    calendar: 'Calendar',
    contacts: 'Contacts',
    expo: 'Expo / EAS',
    expo_manual_actions: 'Manual Expo actions',
    sessions: 'Sessions / sub-agents',
    agents: 'Agent management',
    media: 'Media tools',
    device: 'Device tools',
    communication: 'Communication',
    workspace_files: 'Workspace files',
    pdf: 'PDF',
    cron: 'Automation',
    memory_search: 'Memory search',
    mcp: 'MCP tools',
    skills: 'Skills',
    other: 'Other',
  };

  return (
    labels[category] ?? category.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function mapDeferredCategoryToToolCatalogCategory(category: string): string | null {
  const mapping: Record<string, string> = {
    workspace_search: 'files',
    code: 'code',
    web_research: 'web',
    browser: 'browser',
    canvas: 'canvas',
    ssh: 'ssh',
    calendar: 'calendar',
    contacts: 'contacts',
    expo: 'expo',
    expo_manual_actions: 'expo',
    sessions: 'sessions',
    agents: 'agents',
    media: 'media',
    device: 'native',
    communication: 'interaction',
    workspace_files: 'workspace',
    pdf: 'pdf',
    cron: 'automation',
    memory_search: 'memory',
    mcp: 'mcp',
    skills: 'skills',
  };

  return mapping[category] ?? null;
}

function buildDeferredCategoryDiscoveryHint(category: string): string {
  const toolCatalogCategory = mapDeferredCategoryToToolCatalogCategory(category);
  return toolCatalogCategory ? ` Inspect with tool_catalog category="${toolCatalogCategory}".` : '';
}

// ── Deferred tool catalog ────────────────────────────────────────────────

/**
 * Generate a compact text catalog of deferred (not-loaded) tools.
 * This is injected into the system prompt so the LLM knows what's available
 * via the tool_catalog tool.
 */
export function buildDeferredToolCatalog(
  allTools: ToolDefinition[],
  loadedTools: ToolDefinition[],
): string {
  const loadedNames = new Set(loadedTools.map((t) => t.name));
  const deferred = allTools.filter((t) => !loadedNames.has(t.name));

  if (deferred.length === 0) return '';

  const toolToCategory = new Map<string, string>();
  for (const category of TOOL_CATEGORIES) {
    for (const toolName of category.toolNames) {
      toolToCategory.set(toolName, category.name);
    }
  }

  const grouped = new Map<string, string[]>();
  for (const tool of deferred) {
    const category = tool.name.startsWith('mcp__')
      ? 'mcp'
      : tool.name.startsWith('skill__')
        ? 'skills'
        : toolToCategory.get(tool.name) || 'other';
    const names = grouped.get(category) || [];
    names.push(tool.name);
    grouped.set(category, names);
  }

  const groupLines = Array.from(grouped.entries())
    .sort((left, right) => {
      const countDiff = right[1].length - left[1].length;
      return countDiff !== 0 ? countDiff : left[0].localeCompare(right[0]);
    })
    .slice(0, 8)
    .map(([category, names]) => {
      const visible = names.slice(0, 3);
      const hiddenCount = names.length - visible.length;
      const hint = buildDeferredCategoryDiscoveryHint(category);
      return hiddenCount > 0
        ? `- ${formatDeferredCategoryLabel(category)}: ${visible.join(', ')}, and ${hiddenCount} more.${hint}`
        : `- ${formatDeferredCategoryLabel(category)}: ${visible.join(', ')}.${hint}`;
    });

  const hiddenGroupCount = grouped.size - Math.min(grouped.size, 8);
  if (hiddenGroupCount > 0) {
    groupLines.push(`- Additional capability groups: ${hiddenGroupCount} more.`);
  }

  return [
    `\n<deferred_tools count="${deferred.length}">`,
    'Deferred capabilities exist beyond the loaded tool set.',
    'Use tool_catalog query="what you need to do" when you know the task but not the exact tool name. Use category="..." when you intentionally want to inspect an entire capability family, or call it without arguments for the full grouped catalog.',
    ...groupLines,
    '</deferred_tools>',
  ].join('\n');
}
