// ---------------------------------------------------------------------------
// Kavi — Curated MCP Server Presets
// ---------------------------------------------------------------------------
// Pre-configured MCP server entries that users can one-tap install.
// Covers popular community servers and common use cases.

import type { McpServerConfig } from '../types';

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  category: McpPresetCategory;
  icon: string;
  /** Pre-filled config; user may still need to provide API keys */
  config: Omit<McpServerConfig, 'id' | 'tools' | 'allowedTools'> & {
    tools?: McpServerConfig['tools'];
    allowedTools?: McpServerConfig['allowedTools'];
  };
  /** Input specs for required user configuration */
  requiredInputs: McpPresetInput[];
  /** URL for documentation */
  docsUrl?: string;
}

export interface McpPresetInput {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  required: boolean;
}

export type McpPresetCategory =
  | 'productivity'
  | 'development'
  | 'data'
  | 'ai'
  | 'communication'
  | 'search'
  | 'media'
  | 'finance'
  | 'other';

export const MCP_PRESET_CATEGORIES: { key: McpPresetCategory; label: string; icon: string }[] = [
  { key: 'productivity', label: 'Productivity', icon: '📋' },
  { key: 'development', label: 'Development', icon: '💻' },
  { key: 'data', label: 'Data & Databases', icon: '🗄️' },
  { key: 'ai', label: 'AI & ML', icon: '🧠' },
  { key: 'communication', label: 'Communication', icon: '💬' },
  { key: 'search', label: 'Search & Web', icon: '🔍' },
  { key: 'media', label: 'Media & Files', icon: '📁' },
  { key: 'finance', label: 'Finance', icon: '💰' },
  { key: 'other', label: 'Other', icon: '🔧' },
];

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'preset-github',
    name: 'GitHub',
    description: 'Browse repos, issues, PRs, and code search via the GitHub API.',
    category: 'development',
    icon: '🐙',
    config: {
      name: 'GitHub',
      url: 'https://api.githubcopilot.com/mcp/',
      enabled: true,
      headers: {},
    },
    requiredInputs: [
      {
        key: 'Authorization',
        label: 'GitHub Token',
        placeholder: 'ghp_...',
        secret: true,
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'preset-filesystem',
    name: 'Filesystem',
    description: 'Read, write, and manage files in a local directory on your server.',
    category: 'productivity',
    icon: '📂',
    config: {
      name: 'Filesystem',
      url: 'https://localhost:3000/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [
      {
        key: 'root_path',
        label: 'Root Directory',
        placeholder: '/home/user/projects',
        secret: false,
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'preset-postgres',
    name: 'PostgreSQL',
    description: 'Query and manage PostgreSQL databases with read/write operations.',
    category: 'data',
    icon: '🐘',
    config: {
      name: 'PostgreSQL',
      url: 'https://localhost:3001/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [
      {
        key: 'connection_string',
        label: 'Connection String',
        placeholder: 'postgresql://user:pass@host/db',
        secret: true,
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'preset-sqlite',
    name: 'SQLite',
    description: 'Query and manage local SQLite databases.',
    category: 'data',
    icon: '🗃️',
    config: {
      name: 'SQLite',
      url: 'https://localhost:3002/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [
      {
        key: 'db_path',
        label: 'Database Path',
        placeholder: '/path/to/database.db',
        secret: false,
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'preset-brave-search',
    name: 'Brave Search',
    description: 'Web and local search using the Brave Search API.',
    category: 'search',
    icon: '🦁',
    config: {
      name: 'Brave Search',
      url: 'https://localhost:3003/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave API Key',
        placeholder: 'BSA...',
        secret: true,
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'preset-slack',
    name: 'Slack',
    description: 'Read and post messages in Slack channels and DMs.',
    category: 'communication',
    icon: '💬',
    config: {
      name: 'Slack',
      url: 'https://localhost:3004/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Slack Bot Token',
        placeholder: 'xoxb-...',
        secret: true,
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
  {
    id: 'preset-google-drive',
    name: 'Google Drive',
    description: 'Search, read, and manage files in Google Drive.',
    category: 'productivity',
    icon: '📁',
    config: {
      name: 'Google Drive',
      url: 'https://localhost:3005/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [
      {
        key: 'GOOGLE_CLIENT_ID',
        label: 'Client ID',
        placeholder: 'client-id.apps.googleusercontent.com',
        secret: true,
        required: true,
      },
      {
        key: 'GOOGLE_CLIENT_SECRET',
        label: 'Client Secret',
        placeholder: 'GOCSPX-...',
        secret: true,
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
  },
  {
    id: 'preset-memory',
    name: 'Memory',
    description: 'Persistent key-value memory store for the AI agent using a knowledge graph.',
    category: 'ai',
    icon: '🧠',
    config: {
      name: 'Memory',
      url: 'https://localhost:3006/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'preset-puppeteer',
    name: 'Puppeteer',
    description:
      'Browser automation with Puppeteer — navigate, screenshot, interact with web pages.',
    category: 'development',
    icon: '🎭',
    config: {
      name: 'Puppeteer',
      url: 'https://localhost:3007/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'preset-sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Enhanced reasoning through structured step-by-step thinking chains.',
    category: 'ai',
    icon: '🧩',
    config: {
      name: 'Sequential Thinking',
      url: 'https://localhost:3008/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'preset-fetch',
    name: 'Fetch',
    description: 'HTTP requests to any URL with support for robots.txt and content extraction.',
    category: 'search',
    icon: '🌐',
    config: {
      name: 'Fetch',
      url: 'https://localhost:3009/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'preset-sentry',
    name: 'Sentry',
    description: 'Search and retrieve Sentry issues, events, and error details.',
    category: 'development',
    icon: '🐛',
    config: {
      name: 'Sentry',
      url: 'https://localhost:3010/mcp',
      enabled: true,
      headers: {},
    },
    requiredInputs: [
      {
        key: 'SENTRY_AUTH_TOKEN',
        label: 'Sentry Auth Token',
        placeholder: 'sntrys_...',
        secret: true,
        required: true,
      },
      {
        key: 'SENTRY_ORG',
        label: 'Organization Slug',
        placeholder: 'my-org',
        secret: false,
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sentry',
  },
];

/**
 * Get presets by category.
 */
export function getPresetsByCategory(category: McpPresetCategory): McpPreset[] {
  return MCP_PRESETS.filter((p) => p.category === category);
}

/**
 * Search presets by name or description.
 */
export function searchPresets(query: string): McpPreset[] {
  const q = query.toLowerCase().trim();
  if (!q) return MCP_PRESETS;
  return MCP_PRESETS.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.includes(q),
  );
}
