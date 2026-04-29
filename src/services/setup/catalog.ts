import type { ToolDefinition } from '../../types';

export interface ServiceSetupField {
  storageKey: string;
  label: string;
  placeholder: string;
  hint: string;
  category: string;
  unlocks: string;
  setup: string;
  freeAccess: string;
  docsUrl?: string;
  tools: string[];
}

export interface ToolPermissionGroup {
  id: string;
  title: string;
  description: string;
  tools: string[];
}

export const SERVICE_SETUP_FIELDS: ServiceSetupField[] = [
  {
    storageKey: 'BRAVE_API_KEY',
    label: 'Brave Search API Key',
    placeholder: 'BSA...',
    hint: 'Used when web search runs through Brave.',
    category: 'Web search',
    unlocks: 'Brave-backed web search with grounded result links and snippets.',
    setup:
      'Create a Brave Search API account, open the dashboard, then copy your subscription token into this field.',
    freeAccess:
      'Brave Search pricing currently includes free $5 in credits every month, which is enough to test the integration without paying upfront.',
    docsUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started',
    tools: ['web_search'],
  },
  {
    storageKey: 'PERPLEXITY_API_KEY',
    label: 'Perplexity API Key',
    placeholder: 'pplx-...',
    hint: 'Used for Perplexity web search.',
    category: 'Web search',
    unlocks: 'Perplexity-backed web search when you explicitly pick that provider.',
    setup: 'Create an API key from the Perplexity dashboard, then paste the key here.',
    freeAccess:
      'Perplexity access is account-credit based. Treat this as paid unless your own Perplexity plan says otherwise.',
    docsUrl: 'https://docs.perplexity.ai/guides/getting-started',
    tools: ['web_search'],
  },
  {
    storageKey: 'XAI_API_KEY',
    label: 'xAI API Key',
    placeholder: 'xai-...',
    hint: 'Used for Grok web search.',
    category: 'Web search',
    unlocks: 'Grok-powered web search through xAI.',
    setup: 'Open the xAI developer console, create an API key, then paste it here.',
    freeAccess:
      'xAI documentation points users to console billing, so plan for paid usage rather than a guaranteed free tier.',
    docsUrl: 'https://docs.x.ai/developers/quickstart',
    tools: ['web_search'],
  },
  {
    storageKey: 'KIMI_API_KEY',
    label: 'Kimi API Key',
    placeholder: 'sk-...',
    hint: 'Used for Moonshot Kimi web search.',
    category: 'Web search',
    unlocks: 'Moonshot Kimi-backed search for users who prefer that provider.',
    setup: 'Create a Moonshot account, generate an API key, then paste it here.',
    freeAccess:
      'Kimi availability and billing can vary by region, so verify the current free quota in your Moonshot account before relying on it.',
    docsUrl: 'https://platform.moonshot.ai/',
    tools: ['web_search'],
  },
  {
    storageKey: 'GOOGLE_API_KEY',
    label: 'Google AI API Key',
    placeholder: 'AIza...',
    hint: 'Used for Gemini web search with Vertex AI or Google AI Studio.',
    category: 'Web search',
    unlocks: 'Gemini-backed search and Google AI integrations.',
    setup:
      'Open Vertex AI in Google Cloud to create an API key for production-oriented Gemini access, or use Google AI Studio if you are keeping a legacy Developer API setup. The Gemini web search tool can use either key type.',
    freeAccess:
      'Vertex AI express mode and Google AI Studio both allow initial testing, but production usage should assume billed limits and restricted credentials.',
    docsUrl: 'https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys',
    tools: ['web_search'],
  },
  {
    storageKey: 'FIRECRAWL_API_KEY',
    label: 'Firecrawl API Key',
    placeholder: 'fc-...',
    hint: 'Fallback extractor for difficult web pages.',
    category: 'Web extraction',
    unlocks:
      'Fallback extraction for pages that are difficult to fetch cleanly with the built-in scraper.',
    setup: 'Create a Firecrawl account and copy the API key from the dashboard.',
    freeAccess:
      'Firecrawl currently offers 500 free credits on the free plan with no card required, which is enough to test web_fetch fallback behavior.',
    docsUrl: 'https://www.firecrawl.dev/pricing',
    tools: ['web_fetch'],
  },
  {
    storageKey: 'OPENWEATHER_API_KEY',
    label: 'OpenWeather API Key',
    placeholder: 'weather-key',
    hint: 'Enables the built-in weather skill.',
    category: 'Service skill',
    unlocks: 'Weather and forecast tools inside chat.',
    setup:
      'Create an OpenWeather account, generate an API key from the dashboard, then paste it here. Activation can take a short time after signup.',
    freeAccess:
      'OpenWeather currently offers a free plan for current weather and forecast APIs with 60 calls per minute and 1,000,000 calls per month.',
    docsUrl: 'https://openweathermap.org/price',
    tools: ['skill__weather__current', 'skill__weather__forecast'],
  },
  {
    storageKey: 'GITHUB_TOKEN',
    label: 'GitHub Personal Access Token',
    placeholder: 'github_pat_...',
    hint: 'Enables the built-in GitHub repositories, files, branches, commits, issues, and pull requests skill.',
    category: 'Service skill',
    unlocks:
      'GitHub repo listing, private repo file reads, branch creation, API-based commits, issue tools, and pull request creation.',
    setup:
      'In GitHub Settings, open Developer settings, create a fine-grained personal access token, select the smallest repository access you need, and grant repository contents, metadata, pull requests, and issues permissions only where your workflow needs them.',
    freeAccess:
      'Creating a GitHub personal access token is free with a GitHub account. Prefer fine-grained tokens for tighter scope control.',
    docsUrl:
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    tools: [
      'skill__github__repos',
      'skill__github__branches',
      'skill__github__list_files',
      'skill__github__read_file',
      'skill__github__create_branch',
      'skill__github__commit_files',
      'skill__github__issues',
      'skill__github__create_issue',
      'skill__github__create_pull_request',
    ],
  },
  {
    storageKey: 'ALPHA_VANTAGE_API_KEY',
    label: 'Alpha Vantage API Key',
    placeholder: 'alpha-vantage-key',
    hint: 'Enables the built-in finance skill for stock quotes.',
    category: 'Service skill',
    unlocks: 'Stock quote and finance tools.',
    setup:
      'Claim a free API key from Alpha Vantage support, verify your email if needed, then paste the key here.',
    freeAccess:
      'Alpha Vantage explicitly offers a free API key with lifetime access and up to 25 requests per day on the free tier.',
    docsUrl: 'https://www.alphavantage.co/support/#api-key',
    tools: ['skill__finance__stock_quote'],
  },
];

export const TOOL_PERMISSION_GROUPS: ToolPermissionGroup[] = [
  {
    id: 'core',
    title: 'Core Workspace',
    description:
      'Read, write, search, workflow evidence, memory, scheduling, and JavaScript execution.',
    tools: [
      'read_file',
      'write_file',
      'list_files',
      'read_workflow_evidence',
      'record_workflow_evidence',
      'javascript',
      'python',
      'file_edit',
      'glob_search',
      'text_search',
      'cron',
    ],
  },
  {
    id: 'web',
    title: 'Web Tools',
    description: 'Search the web and extract page content.',
    tools: ['web_search', 'web_fetch'],
  },
  {
    id: 'media',
    title: 'Media & Output',
    description: 'Notifications, image generation and editing, audio transcription, and speech.',
    tools: [
      'image_generate',
      'image_edit',
      'audio_transcribe',
      'speak',
      'poll_create',
    ],
  },
  {
    id: 'device',
    title: 'Device Tools',
    description: 'Calendar, contacts, location, clipboard, sharing, and device status.',
    tools: [
      'calendar_list',
      'calendar_events',
      'calendar_create_event',
      'email_compose',
      'sms_compose',
      'phone_call',
      'maps_open',
      'contacts_pick',
      'contacts_manage_access',
      'contacts_form',
      'contacts_share',
      'contacts_search_full',
      'contacts_get_full',
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
      'camera_snap',
    ],
  },
  {
    id: 'canvas',
    title: 'Canvas & Sessions',
    description: 'Session-local canvases, canvas inspection, sub-agents, and PDF analysis.',
    tools: [
      'canvas_list',
      'canvas_read',
      'canvas_create',
      'canvas_update',
      'canvas_delete',
      'canvas_navigate',
      'canvas_eval',
      'canvas_snapshot',
      'sessions_spawn',
      'sessions_list',
      'sessions_send',
      'sessions_history',
      'sessions_output',
      'sessions_surface_output',
      'sessions_status',
      'sessions_wait',
      'pdf_read',
    ],
  },
  {
    id: 'ssh',
    title: 'SSH & Remote Files',
    description:
      'Remote shell execution and SFTP-backed file operations on configured SSH targets.',
    tools: [
      'ssh_exec',
      'ssh_list_directory',
      'ssh_read_file',
      'ssh_write_file',
      'ssh_rename_path',
      'ssh_delete_path',
      'ssh_make_directory',
    ],
  },
  {
    id: 'agents',
    title: 'Agents & Memory',
    description: 'Semantic memory and agent persona management.',
    tools: ['memory_search', 'tool_catalog', 'agents'],
  },
];

export function getServiceSetupField(storageKey: string): ServiceSetupField | undefined {
  return SERVICE_SETUP_FIELDS.find((field) => field.storageKey === storageKey);
}

export function orderToolsByGroup(
  definitions: ToolDefinition[],
): Array<ToolPermissionGroup & { definitions: ToolDefinition[] }> {
  const definitionMap = new Map(definitions.map((definition) => [definition.name, definition]));

  return TOOL_PERMISSION_GROUPS.map((group) => ({
    ...group,
    definitions: group.tools
      .map((toolName) => definitionMap.get(toolName))
      .filter((definition): definition is ToolDefinition => Boolean(definition)),
  })).filter((group) => group.definitions.length > 0);
}
