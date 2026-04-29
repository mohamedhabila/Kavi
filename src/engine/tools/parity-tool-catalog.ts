import { mcpManager } from '../../services/mcp/manager';
import {
  PYTHON_EXTENSION_EXAMPLES,
  PYTHON_EXTENSION_POLICY,
  PYTHON_EXTENSION_WHEN_NEEDED,
} from '../../services/python/guidance';
import {
  getSkillToolDefinitions,
  isSkillCompatible,
  useSkillsStore,
} from '../../services/skills/manager';
import type { SkillEntry } from '../../services/skills/types';
import { TOOL_DEFINITIONS } from './definitions';

function slugifyCatalogValue(value: string | undefined): string {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'skill';
}

function getSkillCatalogLocation(entry: SkillEntry): string {
  const managedDir =
    entry.source.managedDir ||
    `${slugifyCatalogValue(entry.metadata.name)}-${slugifyCatalogValue(entry.source.id || entry.id)}`;
  return `skills/${managedDir}/SKILL.md`;
}

function filterCatalogEntriesByVisibility<T extends { name: string }>(
  entries: T[],
  availableToolNames?: ReadonlySet<string>,
): T[] {
  if (!availableToolNames) {
    return entries;
  }

  return entries.filter((entry) => availableToolNames.has(entry.name));
}

type ToolCatalogCategoryConfig = {
  tools: string[];
  purpose: string;
  guidance?: string;
};

type ToolCatalogSearchToolEntry = {
  name: string;
  description: string;
  category: string;
  source: 'built-in' | 'mcp' | 'skill';
  purpose?: string;
  guidance?: string;
  serverName?: string;
  skillName?: string;
};

type ToolCatalogSearchSkillEntry = {
  id: string;
  name: string;
  description: string;
  invocationPolicy: string;
  location: string;
};

const TOOL_CATALOG_QUERY_DEFAULT_MAX_RESULTS = 6;
const TOOL_CATALOG_QUERY_MAX_RESULTS_CAP = 10;
const TOOL_CATALOG_SHORT_TOKEN_ALLOWLIST = new Set([
  'adb',
  'api',
  'eas',
  'git',
  'ios',
  'mcp',
  'ota',
  'pdf',
  'pr',
  'sms',
  'ssh',
  'tts',
  'url',
]);
const TOOL_CATALOG_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'available',
  'be',
  'by',
  'can',
  'capability',
  'capabilities',
  'do',
  'find',
  'for',
  'from',
  'get',
  'help',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'need',
  'of',
  'on',
  'or',
  'perform',
  'right',
  'show',
  'task',
  'that',
  'the',
  'this',
  'to',
  'tool',
  'tools',
  'use',
  'using',
  'want',
  'with',
  'what',
  'which',
  'you',
  'your',
]);

const TOOL_CATALOG_CATEGORIES: Record<string, ToolCatalogCategoryConfig> = {
  files: {
    tools: ['read_file', 'write_file', 'list_files', 'file_edit', 'glob_search', 'text_search'],
    purpose: 'Search, read, create, and edit files in the conversation workspace.',
    guidance:
      'For codebase investigation, prefer glob_search or text_search first, then read_file. When changing an existing file, prefer file_edit with ordered edits after inspecting the target; reserve write_file for new files or intentional full rewrites.',
  },
  browser: {
    tools: [
      'browser_launch',
      'browser_navigate',
      'browser_snapshot',
      'browser_screenshot',
      'browser_click',
      'browser_type',
      'browser_press_key',
      'browser_hover',
      'browser_select',
      'browser_drag',
      'browser_wait',
      'browser_console',
      'browser_errors',
      'browser_network',
      'browser_cookies',
      'browser_storage',
      'browser_status',
      'browser_evaluate',
      'browser_upload',
      'browser_download',
      'browser_pdf',
      'browser_fill_form',
      'browser_dialog',
    ],
    purpose: 'Launch and control websites interactively.',
    guidance:
      'For website automation, start with browser_launch or browser_navigate, inspect with browser_snapshot or browser_screenshot, then click, type, or evaluate as needed.',
  },
  workspace: {
    tools: [
      'workspace_list_files',
      'workspace_read_file',
      'workspace_write_file',
      'workspace_mkdir',
      'workspace_rename',
      'workspace_delete',
    ],
    purpose: 'Read and modify files in configured external workspace targets.',
    guidance:
      'Inspect the target first with workspace_list_files or workspace_read_file, then make focused changes with workspace_write_file or workspace_rename.',
  },
  web: {
    tools: ['web_search', 'web_fetch'],
    purpose: 'Search the web and fetch online documentation or pages.',
    guidance:
      'Use web_search for discovery, then web_fetch to read the exact page you need.',
  },
  canvas: {
    tools: [
      'canvas_list',
      'canvas_read',
      'canvas_create',
      'canvas_update',
      'canvas_delete',
      'canvas_navigate',
      'canvas_eval',
      'canvas_snapshot',
    ],
    purpose: 'Create, inspect, read, update, evaluate, and capture session canvas previews.',
    guidance:
      'Call canvas_list first to inspect existing session surfaces, use canvas_read to inspect stored content or live DOM, prefer canvas_update over canvas_create when editing, use directoryPath for multi-file HTML/CSS/JS apps, use filePath for a single local HTML entry file, use contentEdits for focused HTML/source patches and componentOperations or dataOperations for structured updates, use canvas_eval for JavaScript execution or DOM changes, and reserve workspace file tools for explicit persistence or export requests.',
  },
  ssh: {
    tools: [
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
    purpose: 'Execute commands and work with files on configured SSH targets.',
    guidance:
      'Prefer ssh_list_directory or ssh_read_file before ssh_write_file or ssh_delete_path when you are still inspecting a remote server. If you start a background SSH command, continue with ssh_background_job_status or ssh_background_job_wait using the returned jobId until it reaches a terminal state.',
  },
  expo: {
    tools: [
      'expo_eas_create_project',
      'expo_eas_list_projects',
      'expo_eas_status',
      'expo_eas_probe',
      'expo_eas_build',
      'expo_eas_update',
      'expo_eas_submit',
      'expo_eas_deploy_web',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
      'expo_eas_graphql',
    ],
    purpose: 'Inspect or operate Expo and EAS projects, builds, updates, and workflows.',
    guidance:
      'Use expo_eas_list_projects to discover project ids, expo_eas_status or expo_eas_probe for readiness checks, and workflow_* tools to monitor runs.',
  },
  sessions: {
    tools: [
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
    purpose: 'Manage sub-agents, background sessions, and waiting states.',
    guidance:
      'Sub-agents and sessions_send follow-up workers run in the background by default and keep working until completion unless you set timeoutMs. Use sessions_wait when you need one or more worker outputs before proceeding; completed wait results already include the same outputs that sessions_output would return. Use sessions_output later only when you need to fetch or recall a terminal deliverable without waiting again. Use sessions_surface_output when that deliverable should become the visible user answer directly, use sessions_history when you need transcript or reasoning trace, use sessions_status for live inspection or diagnosing drift, and reserve waitForCompletion for intentionally blocking the current spawn or send tool call.',
  },
  agents: {
    tools: ['agents'],
    purpose: 'Inspect, switch, or configure agent/persona behavior.',
  },
  calendar: {
    tools: ['calendar_list', 'calendar_events', 'calendar_create_event'],
    purpose: 'Inspect device calendars and create events.',
    guidance:
      'Call calendar_list before calendar_create_event when you need a specific calendarId.',
  },
  contacts: {
    tools: [
      'contacts_pick',
      'contacts_manage_access',
      'contacts_form',
      'contacts_share',
      'contacts_search_full',
      'contacts_get_full',
    ],
    purpose:
      'Pick, inspect, edit, create, and share device contacts with privacy-first native flows.',
  },
  native: {
    tools: [
      'email_compose',
      'sms_compose',
      'phone_call',
      'maps_open',
      'location_current',
      'clipboard',
      'share',
      'open_url',
      'notification_send',
      'notification_schedule',
      'device_query',
      'photos_latest',
      'camera_clip',
      'screen_record',
    ],
    purpose: 'Device, clipboard, notifications, location, sharing, and other mobile utility tools.',
  },
  media: {
    tools: ['camera_snap', 'audio_transcribe', 'speak', 'image_generate', 'image_edit'],
    purpose: 'Capture, generate, or edit media and speech.',
    guidance:
      'Use image_generate to create a new image from scratch. Use image_edit when the task must modify an existing workspace image while preserving specific content.',
  },
  memory: {
    tools: [
      'read_workflow_evidence',
      'record_workflow_evidence',
      'memory_search',
      'memory_recall',
      'memory_remember',
      'memory_manage',
      'memory_block',
    ],
    purpose:
      'Read, write, and search persisted memory plus structured workflow evidence and the living-memory fact/block store.',
    guidance:
      'Use workflow evidence for run-scoped facts, verification notes, risks, decisions, and artifacts that should stay attached to the current agent run. ' +
      'Prefer memory_recall + memory_remember for structured atomic facts about the user/project/concepts (subject + predicate + value); memory_manage covers pin/unpin/forget. Use memory_search when you need fuzzy or unstructured search instead. memory_block (action=read|edit) operates on short editable scratch surfaces (persona, scratchpad) that always appear in the focus header.',
  },
  automation: {
    tools: ['cron', 'notification_send', 'notification_schedule'],
    purpose: 'Create scheduled tasks, cron jobs, and user alerts.',
  },
  code: {
    tools: ['javascript', 'python'],
    purpose:
      'Run sandboxed JavaScript or Python for calculations, data transformation, script execution, and capability-extension workflows.',
    guidance: `Use javascript for lightweight synchronous calculations or text transformations. Use python for Pyodide-compatible scripts, data/science libraries, or when the task explicitly requires Python. ${PYTHON_EXTENSION_WHEN_NEEDED} ${PYTHON_EXTENSION_EXAMPLES} ${PYTHON_EXTENSION_POLICY}`,
  },
  pdf: {
    tools: ['pdf_read'],
    purpose: 'Read and extract content from PDF documents.',
  },
  interaction: {
    tools: ['poll_create'],
    purpose: 'Interactive response helpers such as polls.',
  },
};

function normalizeToolCatalogSearchText(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeToolCatalogSearchText(value: string | undefined): string[] {
  const normalized = normalizeToolCatalogSearchText(value);
  if (!normalized) {
    return [];
  }

  return Array.from(
    new Set(
      normalized
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .filter((token) => token.length >= 3 || TOOL_CATALOG_SHORT_TOKEN_ALLOWLIST.has(token))
        .filter((token) => !TOOL_CATALOG_STOP_WORDS.has(token)),
    ),
  );
}

function buildToolCatalogQueryPhrases(tokens: string[]): string[] {
  const phrases: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return Array.from(new Set(phrases));
}

function hasToolCatalogPrefixMatch(tokens: Set<string>, queryToken: string): boolean {
  for (const token of tokens) {
    if (token.startsWith(queryToken) || queryToken.startsWith(token)) {
      return true;
    }
  }
  return false;
}

function scoreToolCatalogSearchCandidate(params: {
  query: string;
  queryTokens: string[];
  queryPhrases: string[];
  name: string;
  description?: string;
  categoryLabel?: string;
  purpose?: string;
  guidance?: string;
  extraTexts?: string[];
}): { score: number; matchedFields: string[] } {
  const normalizedQuery = normalizeToolCatalogSearchText(params.query);
  const nameText = normalizeToolCatalogSearchText(params.name);
  const descriptionText = normalizeToolCatalogSearchText(params.description);
  const categoryText = normalizeToolCatalogSearchText(params.categoryLabel);
  const purposeText = normalizeToolCatalogSearchText(params.purpose);
  const guidanceText = normalizeToolCatalogSearchText(params.guidance);
  const extraText = normalizeToolCatalogSearchText((params.extraTexts || []).join(' '));

  const nameTokens = new Set(tokenizeToolCatalogSearchText(params.name));
  const descriptionTokens = new Set(tokenizeToolCatalogSearchText(params.description));
  const categoryTokens = new Set(tokenizeToolCatalogSearchText(params.categoryLabel));
  const purposeTokens = new Set(tokenizeToolCatalogSearchText(params.purpose));
  const guidanceTokens = new Set(tokenizeToolCatalogSearchText(params.guidance));
  const extraTokens = new Set(tokenizeToolCatalogSearchText((params.extraTexts || []).join(' ')));

  let score = 0;
  const matchedFields = new Set<string>();

  if (normalizedQuery && nameText.includes(normalizedQuery)) {
    score += 80;
    matchedFields.add('name');
  } else if (
    normalizedQuery &&
    [descriptionText, purposeText, guidanceText, categoryText, extraText].some((text) =>
      text.includes(normalizedQuery),
    )
  ) {
    score += 36;
    matchedFields.add('description');
  }

  for (const token of params.queryTokens) {
    if (nameTokens.has(token)) {
      score += 24;
      matchedFields.add('name');
      continue;
    }
    if (hasToolCatalogPrefixMatch(nameTokens, token)) {
      score += 12;
      matchedFields.add('name');
    }

    if (categoryTokens.has(token)) {
      score += 16;
      matchedFields.add('category');
      continue;
    }
    if (purposeTokens.has(token)) {
      score += 10;
      matchedFields.add('purpose');
      continue;
    }
    if (guidanceTokens.has(token)) {
      score += 8;
      matchedFields.add('guidance');
      continue;
    }
    if (descriptionTokens.has(token) || extraTokens.has(token)) {
      score += 8;
      matchedFields.add('description');
      continue;
    }
    if (
      hasToolCatalogPrefixMatch(descriptionTokens, token) ||
      hasToolCatalogPrefixMatch(purposeTokens, token) ||
      hasToolCatalogPrefixMatch(extraTokens, token)
    ) {
      score += 4;
      matchedFields.add('description');
    }
  }

  for (const phrase of params.queryPhrases) {
    if (nameText.includes(phrase)) {
      score += 18;
      matchedFields.add('name');
      continue;
    }

    if (
      [descriptionText, purposeText, guidanceText, categoryText, extraText].some((text) =>
        text.includes(phrase),
      )
    ) {
      score += 10;
      matchedFields.add('description');
    }
  }

  return { score, matchedFields: Array.from(matchedFields) };
}

function describeToolCatalogSearchMatch(matchedFields: string[]): string | undefined {
  if (matchedFields.length === 0) {
    return undefined;
  }

  const labels: Record<string, string> = {
    name: 'tool name',
    category: 'category',
    purpose: 'category purpose',
    guidance: 'usage guidance',
    description: 'description',
  };

  return `Matched ${matchedFields.map((field) => labels[field] || field).join(', ')} terms.`;
}

function clampToolCatalogMaxResults(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return TOOL_CATALOG_QUERY_DEFAULT_MAX_RESULTS;
  }

  return Math.max(1, Math.min(TOOL_CATALOG_QUERY_MAX_RESULTS_CAP, Math.round(value)));
}

function getDynamicMcpCatalog(options?: { availableToolNames?: ReadonlySet<string> }) {
  const statuses = mcpManager.getAllStatuses();
  const definitionNames =
    typeof (mcpManager as { getAllToolDefinitions?: () => Array<{ name: string }> })
      .getAllToolDefinitions === 'function'
      ? new Set(mcpManager.getAllToolDefinitions().map((tool) => tool.name))
      : null;
  const isToolVisible = (toolName: string): boolean => {
    if (definitionNames && !definitionNames.has(toolName)) {
      return false;
    }
    if (options?.availableToolNames && !options.availableToolNames.has(toolName)) {
      return false;
    }
    return true;
  };
  const servers = statuses
    .filter((status) => status.state === 'connected')
    .map((status) => {
      const tools = status.tools
        .map((tool) => ({
          name: `mcp__${status.id}__${tool.name}`,
          displayName: tool.name,
          description: tool.description ?? tool.name,
        }))
        .filter((tool) => isToolVisible(tool.name));

      return {
        id: status.id,
        name: status.name,
        toolCount: tools.length,
        tools,
      };
    });
  const pendingServers = statuses
    .filter((status) => status.state !== 'connected')
    .map((status) => ({
      id: status.id,
      name: status.name,
      state: status.state,
      authRequired: status.authRequired === true,
    }));
  const tools = servers.flatMap((server) =>
    server.tools.map((tool) => ({
      ...tool,
      serverId: server.id,
      serverName: server.name,
    })),
  );

  return { servers, pendingServers, tools };
}

function getDynamicSkillCatalog(options?: { availableToolNames?: ReadonlySet<string> }) {
  const tools = filterCatalogEntriesByVisibility(
    getSkillToolDefinitions().map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
    })),
    options?.availableToolNames,
  );
  const skills = useSkillsStore
    .getState()
    .getEnabled()
    .filter((entry) => entry.metadata && isSkillCompatible(entry.metadata).compatible)
    .map((entry) => ({
      id: entry.id,
      name: entry.metadata.name,
      description: entry.metadata.description || 'No description provided.',
      invocationPolicy: entry.metadata.invocationPolicy || 'auto',
      location: getSkillCatalogLocation(entry),
    }));

  return { skills, tools };
}

export async function executeToolCatalog(
  args: {
    category?: string;
    query?: string;
    maxResults?: number;
  },
  options?: {
    availableToolNames?: ReadonlySet<string>;
  },
): Promise<string> {
  const availableToolNames = options?.availableToolNames;
  const buildActivation = (
    recommendedToolNames: string[],
    activationOptions?: {
      category?: string;
      supportingToolNames?: string[];
      rationale?: string;
    },
  ) => ({
    callableNextTurn: recommendedToolNames.length > 0,
    recommendedToolNames,
    ...(activationOptions?.supportingToolNames && activationOptions.supportingToolNames.length > 0
      ? { supportingToolNames: activationOptions.supportingToolNames }
      : {}),
    ...(activationOptions?.category ? { category: activationOptions.category } : {}),
    ...(activationOptions?.rationale ? { rationale: activationOptions.rationale } : {}),
  });
  const sampleTools = (toolNames: string[], max = 4) => toolNames.slice(0, max);
  const filterToolNames = (toolNames: string[]) =>
    availableToolNames
      ? toolNames.filter((toolName) => availableToolNames.has(toolName))
      : toolNames;
  const staticVisibleTools = availableToolNames
    ? TOOL_DEFINITIONS.filter((tool) => availableToolNames.has(tool.name))
    : TOOL_DEFINITIONS;
  const mcpCatalog = getDynamicMcpCatalog({ availableToolNames });
  const skillCatalog = getDynamicSkillCatalog({ availableToolNames });
  const requestedCategory =
    typeof args.category === 'string' ? args.category.trim().toLowerCase() : undefined;
  const requestedQuery = typeof args.query === 'string' ? args.query.trim() : '';
  const maxResults = clampToolCatalogMaxResults(args.maxResults);
  const availableCategories = [...Object.keys(TOOL_CATALOG_CATEGORIES), 'mcp', 'skills'];
  const staticToolMap = new Map(staticVisibleTools.map((tool) => [tool.name, tool]));

  if (
    requestedCategory &&
    !TOOL_CATALOG_CATEGORIES[requestedCategory] &&
    requestedCategory !== 'mcp' &&
    requestedCategory !== 'skills'
  ) {
    return JSON.stringify({
      error: `Unknown tool_catalog category: ${args.category}`,
      availableCategories,
      guidance:
        'Use one of the available category names exactly as listed. If you do not know the domain yet, call tool_catalog with query="what you need to do" instead of guessing a category.',
    });
  }

  if (requestedQuery) {
    const queryTokens = tokenizeToolCatalogSearchText(requestedQuery);
    const queryPhrases = buildToolCatalogQueryPhrases(queryTokens);
    const categoryNames = !requestedCategory
      ? Object.keys(TOOL_CATALOG_CATEGORIES)
      : requestedCategory !== 'mcp' && requestedCategory !== 'skills'
        ? [requestedCategory]
        : [];
    const toolCandidates: ToolCatalogSearchToolEntry[] = [];
    const skillEntries: ToolCatalogSearchSkillEntry[] = [];

    for (const categoryName of categoryNames) {
      const config = TOOL_CATALOG_CATEGORIES[categoryName];
      for (const toolName of filterToolNames(config.tools)) {
        if (toolName === 'tool_catalog') {
          continue;
        }

        const tool = staticToolMap.get(toolName);
        if (!tool) {
          continue;
        }

        toolCandidates.push({
          name: tool.name,
          description: tool.description || tool.name,
          category: categoryName,
          source: 'built-in',
          purpose: config.purpose,
          guidance: config.guidance,
        });
      }
    }

    if (!requestedCategory || requestedCategory === 'mcp') {
      for (const tool of mcpCatalog.tools) {
        toolCandidates.push({
          name: tool.name,
          description: tool.description,
          category: 'mcp',
          source: 'mcp',
          purpose: 'Connected external MCP server tools.',
          guidance:
            'Connected MCP tools are callable directly with the exact tool name shown here, including the mcp__serverId__toolName prefix.',
          serverName: tool.serverName,
        });
      }
    }

    if (!requestedCategory || requestedCategory === 'skills') {
      for (const tool of skillCatalog.tools) {
        toolCandidates.push({
          name: tool.name,
          description: tool.description,
          category: 'skills',
          source: 'skill',
          purpose: 'Installed instruction skills plus any callable skill tools.',
          guidance:
            'Read the SKILL.md location before following a skill, and then use one of the listed skill__... tools on the next turn.',
          skillName: tool.name.replace(/^skill__/, '').split('__')[0] || undefined,
        });
      }

      skillEntries.push(...skillCatalog.skills);
    }

    const scoredToolMatches = toolCandidates
      .map((candidate) => {
        const scored = scoreToolCatalogSearchCandidate({
          query: requestedQuery,
          queryTokens,
          queryPhrases,
          name: candidate.name,
          description: candidate.description,
          categoryLabel: candidate.category,
          purpose: candidate.purpose,
          guidance: candidate.guidance,
          extraTexts: [candidate.serverName || '', candidate.skillName || ''],
        });

        return {
          ...candidate,
          score: scored.score,
          matchedFields: scored.matchedFields,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => {
        const scoreDiff = right.score - left.score;
        return scoreDiff !== 0 ? scoreDiff : left.name.localeCompare(right.name);
      })
      .slice(0, maxResults);

    const scoredSkillMatches = skillEntries
      .map((skill) => {
        const scored = scoreToolCatalogSearchCandidate({
          query: requestedQuery,
          queryTokens,
          queryPhrases,
          name: skill.name,
          description: skill.description,
          categoryLabel: 'skills',
          purpose: 'Installed instruction skills plus any callable skill tools.',
          guidance: 'Read the SKILL.md location before following a skill.',
          extraTexts: [skill.location, skill.invocationPolicy],
        });

        return {
          ...skill,
          score: scored.score,
          matchedFields: scored.matchedFields,
        };
      })
      .filter((skill) => skill.score > 0)
      .sort((left, right) => {
        const scoreDiff = right.score - left.score;
        return scoreDiff !== 0 ? scoreDiff : left.name.localeCompare(right.name);
      })
      .slice(0, Math.min(3, maxResults));

    const categorySuggestions = !requestedCategory
      ? availableCategories
          .map((category) => {
            const config =
              category === 'mcp'
                ? {
                    purpose: 'Connected external MCP server tools.',
                    guidance: mcpCatalog.servers
                      .map(
                        (server) =>
                          `${server.name} ${server.tools.map((tool) => tool.displayName).join(' ')}`,
                      )
                      .join(' '),
                  }
                : category === 'skills'
                  ? {
                      purpose: 'Installed instruction skills plus any callable skill tools.',
                      guidance: skillCatalog.skills
                        .map((skill) => `${skill.name} ${skill.description}`)
                        .join(' '),
                    }
                  : {
                      purpose: TOOL_CATALOG_CATEGORIES[category].purpose,
                      guidance: TOOL_CATALOG_CATEGORIES[category].guidance,
                    };
            const scored = scoreToolCatalogSearchCandidate({
              query: requestedQuery,
              queryTokens,
              queryPhrases,
              name: category,
              categoryLabel: category,
              purpose: config.purpose,
              guidance: config.guidance,
            });

            return {
              category,
              score: scored.score,
              purpose: config.purpose,
              inspectWith: `tool_catalog category="${category}"`,
            };
          })
          .filter((entry) => entry.score > 0)
          .sort(
            (left, right) =>
              right.score - left.score || left.category.localeCompare(right.category),
          )
          .slice(0, 3)
          .map(({ category, purpose, inspectWith }) => ({ category, purpose, inspectWith }))
      : [];

    const matchedToolNames = scoredToolMatches.map((tool) => tool.name);
    const recommendedToolNames = matchedToolNames.slice(0, Math.min(3, matchedToolNames.length));
    const supportingToolNames = matchedToolNames.slice(
      recommendedToolNames.length,
      Math.min(recommendedToolNames.length + 4, matchedToolNames.length),
    );
    const guidance =
      matchedToolNames.length > 0
        ? requestedCategory === 'mcp'
          ? 'Use one of the matched MCP tools next with the exact mcp__serverId__toolName shown here. Do not repeat the same search unless the plan changed or the result was incomplete.'
          : requestedCategory === 'skills'
            ? 'Use one of the matched skill__... tools next. If a listed skill looks relevant, read its SKILL.md location before following it. Do not repeat the same search unless the plan changed or the result was incomplete.'
            : 'Use one of the matched tools next. If the needed capability is still unclear, refine the query or browse a narrower category instead of guessing.'
        : scoredSkillMatches.length > 0
          ? 'No callable tool matched strongly enough, but the listed skills look relevant. Read the SKILL.md location for the best match, then use any associated skill__... tool if needed.'
          : categorySuggestions.length > 0
            ? `No strong callable tool match found. Refine the query or inspect one of these likely categories next: ${categorySuggestions.map((entry) => `${entry.category} (${entry.inspectWith})`).join(', ')}.`
            : 'No strong callable tool match found. Refine the query or browse the full catalog overview to inspect categories manually.';

    return JSON.stringify({
      mode: 'search',
      query: requestedQuery,
      ...(requestedCategory ? { category: requestedCategory } : {}),
      matches: scoredToolMatches.map((tool) => ({
        name: tool.name,
        description: tool.description,
        category: tool.category,
        source: tool.source,
        ...(tool.serverName ? { serverName: tool.serverName } : {}),
        ...(tool.skillName ? { skillName: tool.skillName } : {}),
        ...(describeToolCatalogSearchMatch(tool.matchedFields)
          ? { matchReason: describeToolCatalogSearchMatch(tool.matchedFields) }
          : {}),
      })),
      matchingSkills: scoredSkillMatches.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        invocationPolicy: skill.invocationPolicy,
        location: skill.location,
        ...(describeToolCatalogSearchMatch(skill.matchedFields)
          ? { matchReason: describeToolCatalogSearchMatch(skill.matchedFields) }
          : {}),
      })),
      categorySuggestions,
      availableCategories,
      activation: buildActivation(recommendedToolNames, {
        ...(requestedCategory ? { category: requestedCategory } : {}),
        supportingToolNames,
        rationale: guidance,
      }),
      guidance,
    });
  }

  if (requestedCategory === 'mcp') {
    const toolNames = mcpCatalog.tools.map((tool) => tool.name);
    const recommendedToolNames = toolNames.slice(0, Math.min(4, toolNames.length));
    const supportingToolNames = toolNames.slice(recommendedToolNames.length);
    const guidance =
      toolNames.length > 0
        ? 'Connected MCP tools are callable directly with the exact tool name shown here, including the mcp__serverId__toolName prefix. Use one of these tools next instead of repeating tool_catalog for the same category.'
        : 'No callable MCP tools are available under the current tool policy. If you expected an MCP tool here, adjust the current tool allowlist or sandbox policy.';
    return JSON.stringify({
      mode: 'category',
      category: 'mcp',
      servers: mcpCatalog.servers,
      pendingServers: mcpCatalog.pendingServers,
      tools: mcpCatalog.tools,
      activation: buildActivation(recommendedToolNames, {
        category: 'mcp',
        supportingToolNames,
        rationale: guidance,
      }),
      guidance,
    });
  }

  if (requestedCategory === 'skills') {
    const toolNames = skillCatalog.tools.map((tool) => tool.name);
    const recommendedToolNames = toolNames.slice(0, Math.min(4, toolNames.length));
    const supportingToolNames = toolNames.slice(recommendedToolNames.length);
    const guidance =
      toolNames.length > 0
        ? 'Installed skills expose instruction files plus any callable skill__... tools. Read the SKILL.md location before following a skill, and then use one of the listed skill__... tools on the next turn instead of repeating tool_catalog for the same category.'
        : 'No callable skill tools are available under the current tool policy. If you expected a skill tool here, adjust the current tool allowlist or sandbox policy.';
    return JSON.stringify({
      mode: 'category',
      category: 'skills',
      skills: skillCatalog.skills,
      tools: skillCatalog.tools,
      activation: buildActivation(recommendedToolNames, {
        category: 'skills',
        supportingToolNames,
        rationale: guidance,
      }),
      guidance,
    });
  }

  if (requestedCategory) {
    const selectedCategory = TOOL_CATALOG_CATEGORIES[requestedCategory];

    const names = filterToolNames(selectedCategory.tools);
    const tools = staticVisibleTools.filter((t) => names.includes(t.name));
    const recommendedToolNames = tools.slice(0, Math.min(4, tools.length)).map((tool) => tool.name);
    const supportingToolNames = tools.slice(recommendedToolNames.length).map((tool) => tool.name);
    const guidance =
      tools.length > 0
        ? `${selectedCategory.guidance || 'Use one of the discovered tools next.'} Do not repeat tool_catalog for the same category unless the plan changed or the earlier result was incomplete.`
        : 'No callable tools from this category are available under the current tool policy. Pick another category or adjust the current tool allowlist before retrying.';
    return JSON.stringify({
      mode: 'category',
      category: requestedCategory,
      purpose: selectedCategory.purpose,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      activation: buildActivation(recommendedToolNames, {
        category: requestedCategory,
        supportingToolNames,
        rationale: guidance,
      }),
      guidance,
    });
  }

  const catalog: Array<{
    category: string;
    purpose: string;
    count: number;
    sampleTools: string[];
    skills?: string[];
    inspectWith: string;
  }> = Object.entries(TOOL_CATALOG_CATEGORIES)
    .map(([cat, config]) => ({
      category: cat,
      purpose: config.purpose,
      count: filterToolNames(config.tools).length,
      sampleTools: sampleTools(filterToolNames(config.tools)),
      inspectWith: `tool_catalog category="${cat}"`,
    }))
    .filter((entry) => entry.count > 0);
  if (mcpCatalog.servers.length > 0 || mcpCatalog.pendingServers.length > 0) {
    catalog.push({
      category: 'mcp',
      purpose: 'Connected external MCP server tools.',
      count: mcpCatalog.tools.length,
      sampleTools: sampleTools(mcpCatalog.tools.map((tool) => tool.name)),
      inspectWith: 'tool_catalog category="mcp"',
    });
  }
  if (skillCatalog.skills.length > 0 || skillCatalog.tools.length > 0) {
    catalog.push({
      category: 'skills',
      purpose: 'Installed instruction skills plus any callable skill tools.',
      count: skillCatalog.skills.length,
      sampleTools: sampleTools(skillCatalog.tools.map((tool) => tool.name)),
      inspectWith: 'tool_catalog category="skills"',
      skills: skillCatalog.skills.map((skill) => skill.name),
    });
  }

  return JSON.stringify({
    mode: 'overview',
    categories: catalog,
    availableCategories,
    totalTools: staticVisibleTools.length + mcpCatalog.tools.length + skillCatalog.tools.length,
    totalMcpTools: mcpCatalog.tools.length,
    totalSkills: skillCatalog.skills.length,
    totalSkillTools: skillCatalog.tools.length,
    activation: {
      callableNextTurn: false,
      requiresCategorySelection: true,
    },
    guidance:
      'Overview mode is for discovery only. If you know the task but not the tool name, call tool_catalog with query="what you need to do". If you already know the domain, call tool_catalog with that category to make the matching tools callable on the next turn. Use category="files" for repo search/read/edit, "code" for calculations, Python/JavaScript execution, or capability-extension scripts, "web" for online documentation or research, "browser" for interactive website control, "workspace" for configured external workspaces, "mcp" for connected external servers, and "skills" for installed instruction skills.',
  });
}