// ---------------------------------------------------------------------------
// Tests — Tool Manager (tiered selection, provider limits, compression)
// ---------------------------------------------------------------------------

import {
  getProviderToolLimit,
  PROVIDER_TOOL_LIMITS,
  ON_DEVICE_ALWAYS_LOADED_TOOL_NAMES,
  TIER1_TOOL_NAMES,
  TOOL_CATEGORIES,
  detectRelevantCategories,
  selectToolsForRequest,
  resolveToolProviderFamily,
  estimateToolTokens,
  estimateAllToolTokens,
  enforceToolTokenBudget,
  compressToolDescription,
  compressToolDefinitions,
  buildDeferredToolCatalog,
} from '../../src/engine/tools/toolManager';
import { ToolDefinition } from '../../src/types';

// Helper to generate a tool definition
function makeTool(name: string, description = 'Test tool.'): ToolDefinition {
  return {
    name,
    description,
    input_schema: { type: 'object' as const, properties: {} },
  };
}

// ── Provider tool limits ──────────────────────────────────────────────

describe('getProviderToolLimit', () => {
  it('returns 128 for OpenAI', () => {
    expect(getProviderToolLimit('openai')).toBe(128);
    expect(getProviderToolLimit('anything', 'https://api.openai.com/v1')).toBe(128);
  });

  it('returns 20 for Gemini', () => {
    expect(getProviderToolLimit('gemini')).toBe(PROVIDER_TOOL_LIMITS.gemini);
    expect(
      getProviderToolLimit('anything', 'https://generativelanguage.googleapis.com/v1beta/openai'),
    ).toBe(PROVIDER_TOOL_LIMITS.gemini);
  });

  it('returns 64 for Anthropic', () => {
    expect(getProviderToolLimit('anthropic')).toBe(64);
    expect(getProviderToolLimit('mine', 'https://api.anthropic.com')).toBe(64);
  });

  it('returns the lean on-device limit for local Gemma providers', () => {
    expect(getProviderToolLimit('Gemma (on-device)', '', 'gemma-4-E2B-it')).toBe(
      PROVIDER_TOOL_LIMITS['on-device'],
    );
    expect(getProviderToolLimit('Anything', '', 'gemma-4-E2B-it', 'on-device')).toBe(
      PROVIDER_TOOL_LIMITS['on-device'],
    );
  });

  it('uses the effective model family for OpenRouter-hosted Gemini and Anthropic models', () => {
    expect(
      getProviderToolLimit('openrouter', 'https://openrouter.ai/api/v1', 'google/gemini-2.5-pro'),
    ).toBe(PROVIDER_TOOL_LIMITS.gemini);
    expect(
      getProviderToolLimit(
        'openrouter',
        'https://openrouter.ai/api/v1',
        'anthropic/claude-3.7-sonnet',
      ),
    ).toBe(PROVIDER_TOOL_LIMITS.anthropic);
  });

  it('returns 64 for Ollama', () => {
    expect(getProviderToolLimit('ollama')).toBe(64);
  });

  it('returns default (128) for unknown providers', () => {
    expect(getProviderToolLimit('unknown-provider')).toBe(128);
  });
});

describe('resolveToolProviderFamily', () => {
  it('classifies OpenRouter Gemini models as Gemini for tool policy', () => {
    expect(
      resolveToolProviderFamily(
        'openrouter',
        'https://openrouter.ai/api/v1',
        'google/gemini-2.5-pro',
      ),
    ).toBe('gemini');
  });

  it('classifies generic Anthropic models by model name when transport is ambiguous', () => {
    expect(
      resolveToolProviderFamily('custom', 'https://proxy.example.com/v1', 'claude-3-7-sonnet'),
    ).toBe('anthropic');
  });

  it('classifies on-device local providers separately from the default family', () => {
    expect(resolveToolProviderFamily('Gemma (on-device)', '', 'gemma-4-E2B-it')).toBe('on-device');
    expect(resolveToolProviderFamily('Anything', '', 'gemma-4-E2B-it', 'on-device')).toBe(
      'on-device',
    );
  });
});

// ── Category detection ────────────────────────────────────────────────

describe('detectRelevantCategories', () => {
  it('detects browser-related messages', () => {
    const result = detectRelevantCategories(['Please navigate to the website']);
    expect(result.has('browser')).toBe(true);
  });

  it('detects calendar-related messages', () => {
    const result = detectRelevantCategories(['Schedule a meeting for tomorrow']);
    expect(result.has('calendar')).toBe(true);
  });

  it('detects SSH-related messages', () => {
    const result = detectRelevantCategories(['Connect to the remote server via ssh']);
    expect(result.has('ssh')).toBe(true);
  });

  it('detects VS Code-family IDE control requests', () => {
    const result = detectRelevantCategories([
      'Open this repo in Cursor IDE and delegate the fix to its agent',
    ]);
    expect(result.has('workspace_files')).toBe(true);
  });

  it('returns empty set for unrelated messages', () => {
    const result = detectRelevantCategories(['What is 2 + 2?']);
    expect(result.size).toBe(0);
  });

  it('detects multiple categories at once', () => {
    const result = detectRelevantCategories([
      'Take a screenshot of the browser and save it to the remote workspace target',
    ]);
    expect(result.has('browser')).toBe(true);
    expect(result.has('workspace_files')).toBe(true);
  });

  it('does not treat ordinary local file work as remote workspace work', () => {
    const result = detectRelevantCategories([
      'Create a folder in the repo and rename the file locally',
    ]);
    expect(result.has('workspace_files')).toBe(false);
  });

  it('detects code execution requests that explicitly ask for Python', () => {
    const result = detectRelevantCategories(['Run a Python script to parse this JSON payload']);
    expect(result.has('code')).toBe(true);
  });

  it('detects capability-extension export requests that need python scripting', () => {
    const result = detectRelevantCategories([
      'Generate a DOCX report from this CSV export and bundle it as a zip archive',
    ]);
    expect(result.has('code')).toBe(true);
  });

  it('detects media requests that describe editing an image', () => {
    const result = detectRelevantCategories([
      'Edit the image to remove the background and keep the subject intact',
    ]);
    expect(result.has('media')).toBe(true);
  });
});

// ── Tool selection ────────────────────────────────────────────────────

describe('selectToolsForRequest', () => {
  // Generate 150 tools: tier1 tools + many non-tier1 tools
  const tools: ToolDefinition[] = [
    ...Array.from(TIER1_TOOL_NAMES).map((name) =>
      makeTool(name, `Tier1 tool ${name}. Does something essential.`),
    ),
    ...TOOL_CATEGORIES.flatMap((cat) =>
      cat.toolNames.map((name) => makeTool(name, `Category ${cat.name} tool. Does ${name}.`)),
    ),
    // Extra filler tools
    ...Array.from({ length: 30 }, (_, i) => makeTool(`extra_tool_${i}`, `Extra tool ${i}.`)),
  ];

  it('always includes Tier 1 tools', () => {
    const selected = selectToolsForRequest(tools, ['hello'], 'openai');
    const selectedNames = new Set(selected.map((t) => t.name));
    for (const tier1 of TIER1_TOOL_NAMES) {
      expect(selectedNames.has(tier1)).toBe(true);
    }
  });

  it('includes category-matched tools when user message triggers them', () => {
    const selected = selectToolsForRequest(
      tools,
      ['open the browser and navigate to google.com'],
      'openai',
    );
    const selectedNames = new Set(selected.map((t) => t.name));
    expect(selectedNames.has('browser_navigate')).toBe(true);
    expect(selectedNames.has('browser_click')).toBe(true);
  });

  it('includes image_edit for image editing requests', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Edit the image to add a cinematic sunset background'],
      'openai',
    );
    const selectedNames = new Set(selected.map((t) => t.name));

    expect(selectedNames.has('image_generate')).toBe(true);
    expect(selectedNames.has('image_edit')).toBe(true);
  });

  it('does not include remote workspace tools for ordinary repo file tasks', () => {
    const selected = selectToolsForRequest(
      tools,
      ['rename the file in this repo and create a local folder'],
      'openai',
    );
    const selectedNames = new Set(selected.map((t) => t.name));

    expect(selectedNames.has('workspace_read_file')).toBe(false);
    expect(selectedNames.has('workspace_write_file')).toBe(false);
    expect(selectedNames.has('workspace_list_files')).toBe(false);
  });

  it('never exceeds the OpenAI 128 tool limit', () => {
    const selected = selectToolsForRequest(tools, ['do everything'], 'openai');
    expect(selected.length).toBeLessThanOrEqual(128);
  });

  it('respects Ollama 64 tool limit', () => {
    const selected = selectToolsForRequest(tools, ['do everything'], 'ollama');
    expect(selected.length).toBeLessThanOrEqual(64);
  });

  it('keeps MCP tools deferred until discovery selects them', () => {
    const withMcp = [...tools, makeTool('mcp__my_server__my_tool', 'An MCP tool.')];
    const selected = selectToolsForRequest(withMcp, ['hello'], 'openai');
    const selectedNames = selected.map((t) => t.name);
    expect(selectedNames).not.toContain('mcp__my_server__my_tool');
  });

  it('keeps skill tools deferred until discovery selects them', () => {
    const withSkill = [...tools, makeTool('skill__my_skill__my_tool', 'A skill tool.')];
    const selected = selectToolsForRequest(withSkill, ['hello'], 'openai');
    const selectedNames = selected.map((t) => t.name);
    expect(selectedNames).not.toContain('skill__my_skill__my_tool');
  });

  it('loads discovered MCP tools on Gemini without dropping the lean base set', () => {
    const withManyMcpTools = [
      ...tools,
      ...Array.from({ length: 9 }, (_, index) =>
        makeTool(`mcp__srv__tool_${index}`, `MCP tool ${index}.`),
      ),
    ];

    const selected = selectToolsForRequest(
      withManyMcpTools,
      ['hello'],
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      undefined,
      {
        model: 'gemini-2.5-pro',
        discoveredToolNames: Array.from({ length: 9 }, (_, index) => `mcp__srv__tool_${index}`),
      },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    for (let index = 0; index < 9; index += 1) {
      expect(selectedNames.has(`mcp__srv__tool_${index}`)).toBe(true);
    }
    expect(selectedNames.has('tool_catalog')).toBe(true);
    expect(selectedNames.has('read_file')).toBe(true);
    expect(selectedNames.has('glob_search')).toBe(true);
    expect(selectedNames.has('text_search')).toBe(true);
    expect(selectedNames.has('web_search')).toBe(true);
    expect(selected.length).toBeLessThanOrEqual(PROVIDER_TOOL_LIMITS.gemini);
  });

  it('loads discovered skill tools only after discovery identifies them', () => {
    const withSkill = [...tools, makeTool('skill__weather__forecast', 'A weather skill tool.')];
    const selected = selectToolsForRequest(withSkill, ['hello'], 'openai', undefined, undefined, {
      discoveredToolNames: ['skill__weather__forecast'],
    });
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('skill__weather__forecast')).toBe(true);
  });

  it('can narrow the active set to focused discovered tools for the next turn', () => {
    const selected = selectToolsForRequest(
      tools,
      ['tell me a joke'],
      'openai',
      undefined,
      undefined,
      {
        preferredToolNames: ['browser_navigate', 'browser_snapshot'],
        restrictToPreferredTools: true,
      },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('browser_navigate')).toBe(true);
    expect(selectedNames.has('browser_snapshot')).toBe(true);
    expect(selectedNames.has('browser_click')).toBe(false);
    expect(selectedNames).toEqual(
      new Set([...Array.from(TIER1_TOOL_NAMES), 'browser_navigate', 'browser_snapshot']),
    );
  });

  it('keeps supporting discovered tools active on focused follow-up turns', () => {
    const selected = selectToolsForRequest(
      tools,
      ['inspect the discovered browser state and continue'],
      'openai',
      undefined,
      undefined,
      {
        preferredToolNames: ['browser_snapshot'],
        discoveredToolNames: ['browser_snapshot', 'browser_navigate'],
        restrictToPreferredTools: true,
      },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('browser_snapshot')).toBe(true);
    expect(selectedNames.has('browser_navigate')).toBe(true);
    expect(selectedNames.has('browser_click')).toBe(false);
  });

  it('does not backfill unrelated deferred tools for Gemini', () => {
    const selected = selectToolsForRequest(
      tools,
      ['tell me a joke'],
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames).toEqual(
      new Set([
        'read_file',
        'write_file',
        'list_files',
        'record_workflow_evidence',
        'read_workflow_evidence',
        'file_edit',
        'glob_search',
        'text_search',
        'web_search',
        'tool_catalog',
      ]),
    );
  });

  it('applies the Gemini lean base set to OpenRouter-hosted Gemini models', () => {
    const selected = selectToolsForRequest(
      tools,
      ['tell me a joke'],
      'openrouter',
      'https://openrouter.ai/api/v1',
      undefined,
      { model: 'google/gemini-2.5-pro' },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames).toEqual(
      new Set([
        'read_file',
        'write_file',
        'list_files',
        'record_workflow_evidence',
        'read_workflow_evidence',
        'file_edit',
        'glob_search',
        'text_search',
        'web_search',
        'tool_catalog',
      ]),
    );
  });

  it('applies the lean base set to on-device local providers', () => {
    const selected = selectToolsForRequest(
      tools,
      ['tell me a joke'],
      'Gemma (on-device)',
      '',
      undefined,
      {
        model: 'gemma-4-E2B-it',
        providerKind: 'on-device',
      },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames).toEqual(ON_DEVICE_ALWAYS_LOADED_TOOL_NAMES);
    expect(selected.length).toBeLessThanOrEqual(PROVIDER_TOOL_LIMITS['on-device']);
  });

  it('keeps matched category tools deferred on first-turn on-device requests', () => {
    const selected = selectToolsForRequest(
      tools,
      ['open the browser and click the login button'],
      'Gemma (on-device)',
      '',
      undefined,
      {
        model: 'gemma-4-E2B-it',
        providerKind: 'on-device',
      },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames).toEqual(ON_DEVICE_ALWAYS_LOADED_TOOL_NAMES);
    expect(selectedNames.has('browser_navigate')).toBe(false);
    expect(selectedNames.has('browser_click')).toBe(false);
  });

  it('loads focused discovered tools on on-device follow-up turns', () => {
    const selected = selectToolsForRequest(
      tools,
      ['open the browser and click the login button'],
      'Gemma (on-device)',
      '',
      undefined,
      {
        model: 'gemma-4-E2B-it',
        providerKind: 'on-device',
        preferredToolNames: ['browser_navigate', 'browser_click'],
        restrictToPreferredTools: true,
      },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames).toEqual(
      new Set([
        ...Array.from(ON_DEVICE_ALWAYS_LOADED_TOOL_NAMES),
        'browser_navigate',
        'browser_click',
      ]),
    );
  });

  it('does not backfill unrelated deferred tools for OpenAI by default', () => {
    const selected = selectToolsForRequest(tools, ['tell me a joke'], 'openai');
    expect(new Set(selected.map((tool) => tool.name))).toEqual(TIER1_TOOL_NAMES);
  });

  it('loads both python and javascript when the request explicitly asks for Python execution', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Run a Python script to parse this JSON and summarize the keys'],
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      undefined,
      { model: 'gemini-2.5-pro' },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('python')).toBe(true);
    expect(selectedNames.has('javascript')).toBe(true);
  });

  it('loads both python and javascript for docx/export capability-extension requests', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Generate a DOCX report from this CSV export and package it as a zip file'],
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      undefined,
      { model: 'gemini-2.5-pro' },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('python')).toBe(true);
    expect(selectedNames.has('javascript')).toBe(true);
  });

  it('does not backfill manual Expo action tools for ordinary Expo requests', () => {
    const selected = selectToolsForRequest(
      tools,
      ['check the expo deployment status and monitor the workflow'],
      'openai',
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('expo_eas_status')).toBe(true);
    expect(selectedNames.has('expo_eas_workflow_status')).toBe(true);
    expect(selectedNames.has('expo_eas_build')).toBe(false);
    expect(selectedNames.has('expo_eas_update')).toBe(false);
    expect(selectedNames.has('expo_eas_submit')).toBe(false);
    expect(selectedNames.has('expo_eas_deploy_web')).toBe(false);
  });

  it('includes manual Expo action tools when the user explicitly asks for a manual rerun', () => {
    const selected = selectToolsForRequest(
      tools,
      ['manually rerun the expo build now without a commit'],
      'openai',
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('expo_eas_build')).toBe(true);
    expect(selectedNames.has('expo_eas_update')).toBe(true);
    expect(selectedNames.has('expo_eas_submit')).toBe(true);
    expect(selectedNames.has('expo_eas_deploy_web')).toBe(true);
  });

  it('does not backfill unrelated deferred tools for Anthropic', () => {
    const selected = selectToolsForRequest(tools, ['tell me a joke'], 'anthropic');
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames).toEqual(
      new Set([
        'read_file',
        'write_file',
        'list_files',
        'javascript',
        'python',
        'record_workflow_evidence',
        'read_workflow_evidence',
        'file_edit',
        'tool_catalog',
      ]),
    );
  });

  it('loads web tools for Anthropic only when the prompt explicitly asks for web research', () => {
    const selected = selectToolsForRequest(
      tools,
      ['search the web for the latest Claude tool use documentation'],
      'anthropic',
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('web_search')).toBe(true);
    expect(selectedNames.has('web_fetch')).toBe(true);
  });

  it('loads workspace search tools for Anthropic when the prompt is codebase-oriented', () => {
    const selected = selectToolsForRequest(
      tools,
      ['find the file that contains the Anthropic request builder in this repo'],
      'anthropic',
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('glob_search')).toBe(true);
    expect(selectedNames.has('text_search')).toBe(true);
  });
});

// ── Token estimation ──────────────────────────────────────────────────

describe('estimateToolTokens', () => {
  it('estimates a non-zero token count for a tool', () => {
    const tool = makeTool('test_tool', 'A test tool for testing purposes.');
    const tokens = estimateToolTokens(tool);
    expect(tokens).toBeGreaterThan(10);
  });

  it('larger descriptions cost more tokens', () => {
    const small = makeTool('small', 'Short.');
    const large = makeTool(
      'large',
      'A very long description that goes on and on with many details about what this tool does and how to use it properly in various scenarios.',
    );
    expect(estimateToolTokens(large)).toBeGreaterThan(estimateToolTokens(small));
  });
});

describe('estimateAllToolTokens', () => {
  it('sums token costs for all tools', () => {
    const tools = [makeTool('a', 'Tool A.'), makeTool('b', 'Tool B.')];
    const total = estimateAllToolTokens(tools);
    expect(total).toBe(estimateToolTokens(tools[0]) + estimateToolTokens(tools[1]));
  });
});

// ── Token budget enforcement ──────────────────────────────────────────

describe('enforceToolTokenBudget', () => {
  it('returns all tools if under budget', () => {
    const tools = [makeTool('a'), makeTool('b')];
    const result = enforceToolTokenBudget(tools, 100000);
    expect(result.length).toBe(2);
  });

  it('trims non-tier1 tools when over budget', () => {
    const tools = [
      makeTool('read_file', 'A tier 1 tool.'),
      makeTool(
        'removable_tool',
        'A long description that takes up many tokens. This tool does a lot of things that are not essential.',
      ),
    ];
    const tokens = estimateAllToolTokens(tools);
    // Set budget to just above Tier1 cost
    const tier1Cost = estimateToolTokens(tools[0]);
    const result = enforceToolTokenBudget(tools, tier1Cost + 5);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('read_file');
  });

  it('never removes Tier1 tools', () => {
    const tools = Array.from(TIER1_TOOL_NAMES).map((n) => makeTool(n, 'Essential.'));
    const result = enforceToolTokenBudget(tools, 10); // Very tight budget
    // All Tier1 should remain since we never remove priority 0
    expect(result.length).toBe(TIER1_TOOL_NAMES.size);
  });

  it('preserves pinned continuation tools when trimming', () => {
    const tools = [
      makeTool('read_file', 'A tier 1 tool.'),
      makeTool('web_fetch', 'Pinned continuation tool.'),
      makeTool(
        'removable_tool',
        'A long description that takes up many tokens. This tool does a lot of things that are not essential.',
      ),
    ];

    const budget = estimateToolTokens(tools[0]) + estimateToolTokens(tools[1]) + 5;
    const result = enforceToolTokenBudget(tools, budget, {
      pinnedToolNames: ['web_fetch'],
    });

    expect(result.map((tool) => tool.name)).toEqual(['read_file', 'web_fetch']);
  });
});

// ── Tool description compression ──────────────────────────────────────

describe('compressToolDescription', () => {
  it('returns short descriptions unchanged', () => {
    expect(compressToolDescription('Read a file.')).toBe('Read a file.');
  });

  it('truncates to first two sentences', () => {
    const desc = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
    const result = compressToolDescription(desc);
    expect(result).toBe('First sentence. Second sentence.');
  });

  it('handles empty descriptions', () => {
    expect(compressToolDescription('')).toBe('');
  });
});

describe('compressToolDefinitions', () => {
  it('compresses non-Tier1 descriptions', () => {
    const tools = [
      makeTool('read_file', 'Tier1: First sentence. Second sentence. Third long sentence.'),
      makeTool('some_other_tool', 'First sentence. Second sentence. Third sentence that gets cut.'),
    ];
    const compressed = compressToolDefinitions(tools);
    // Tier1 should be unchanged
    expect(compressed[0].description).toBe(tools[0].description);
    // Non-tier1 should be compressed
    expect(compressed[1].description).toBe('First sentence. Second sentence.');
  });
});

// ── Deferred tool catalog ─────────────────────────────────────────────

describe('buildDeferredToolCatalog', () => {
  it('returns empty string when all tools are loaded', () => {
    const tools = [makeTool('a'), makeTool('b')];
    expect(buildDeferredToolCatalog(tools, tools)).toBe('');
  });

  it('summarizes deferred tools in grouped XML format', () => {
    const allTools = [
      makeTool('read_file', 'Alpha tool.'),
      makeTool('browser_navigate', 'Browser nav.'),
      makeTool('browser_click', 'Browser click.'),
      makeTool('web_search', 'Web search.'),
    ];
    const loaded = [makeTool('read_file', 'Alpha tool.')];
    const catalog = buildDeferredToolCatalog(allTools, loaded);
    expect(catalog).toContain('<deferred_tools count="3">');
    expect(catalog).toContain('Deferred capabilities exist beyond the loaded tool set.');
    expect(catalog).toContain(
      '- Browser automation: browser_navigate, browser_click. Inspect with tool_catalog category="browser".',
    );
    expect(catalog).toContain(
      '- Web research: web_search. Inspect with tool_catalog category="web".',
    );
    expect(catalog).toContain('</deferred_tools>');
  });

  it('does not include loaded tools in the catalog', () => {
    const allTools = [makeTool('read_file'), makeTool('web_search')];
    const loaded = [makeTool('read_file')];
    const catalog = buildDeferredToolCatalog(allTools, loaded);
    expect(catalog).not.toContain('read_file');
    expect(catalog).toContain('web_search');
  });

  it('groups deferred MCP and skill capabilities explicitly', () => {
    const allTools = [
      makeTool('read_file'),
      makeTool('mcp__docs__search_docs'),
      makeTool('skill__weather__forecast'),
    ];
    const loaded = [makeTool('read_file')];
    const catalog = buildDeferredToolCatalog(allTools, loaded);

    expect(catalog).toContain(
      '- MCP tools: mcp__docs__search_docs. Inspect with tool_catalog category="mcp".',
    );
    expect(catalog).toContain(
      '- Skills: skill__weather__forecast. Inspect with tool_catalog category="skills".',
    );
  });

  it('groups deferred code tools under the code catalog category', () => {
    const allTools = [makeTool('read_file'), makeTool('javascript'), makeTool('python')];
    const loaded = [makeTool('read_file')];
    const catalog = buildDeferredToolCatalog(allTools, loaded);

    expect(catalog).toContain(
      '- Code / computation: javascript, python. Inspect with tool_catalog category="code".',
    );
  });

  it('groups deferred image_edit under the media catalog category', () => {
    const allTools = [makeTool('read_file'), makeTool('image_generate'), makeTool('image_edit')];
    const loaded = [makeTool('read_file')];
    const catalog = buildDeferredToolCatalog(allTools, loaded);

    expect(catalog).toContain(
      '- Media tools: image_generate, image_edit. Inspect with tool_catalog category="media".',
    );
  });
});

// ── SuperAgent tool injection ─────────────────────────────────────────

describe('selectToolsForRequest — isSuperAgent', () => {
  const tools: ToolDefinition[] = [
    ...Array.from(TIER1_TOOL_NAMES).map((name) => makeTool(name, `Tier1 tool ${name}.`)),
    ...TOOL_CATEGORIES.flatMap((cat) =>
      cat.toolNames.map((name) => makeTool(name, `Category ${cat.name} tool ${name}.`)),
    ),
  ];

  it('includes session tools when isSuperAgent is true even without session keywords', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Build me a full-stack e-commerce app'],
      'openai',
      undefined,
      undefined,
      { isSuperAgent: true },
    );
    const selectedNames = new Set(selected.map((t) => t.name));

    expect(selectedNames.has('sessions_spawn')).toBe(true);
    expect(selectedNames.has('sessions_list')).toBe(true);
    expect(selectedNames.has('sessions_send')).toBe(true);
    expect(selectedNames.has('sessions_output')).toBe(true);
    expect(selectedNames.has('sessions_surface_output')).toBe(true);
    expect(selectedNames.has('sessions_status')).toBe(true);
    expect(selectedNames.has('sessions_wait')).toBe(true);
    expect(selectedNames.has('sessions_cancel')).toBe(true);
    expect(selectedNames.has('sessions_yield')).toBe(true);
    expect(selectedNames.has('wait')).toBe(true);
  });

  it('includes agents tools when isSuperAgent is true', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Tell me a joke'],
      'openai',
      undefined,
      undefined,
      { isSuperAgent: true },
    );
    const selectedNames = new Set(selected.map((t) => t.name));

    expect(selectedNames.has('agents')).toBe(true);
  });

  it('does NOT include session tools when isSuperAgent is false or absent', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Build me a full-stack e-commerce app'],
      'openai',
    );
    const selectedNames = new Set(selected.map((t) => t.name));

    expect(selectedNames.has('sessions_spawn')).toBe(false);
    expect(selectedNames.has('sessions_list')).toBe(false);
    expect(selectedNames.has('sessions_yield')).toBe(false);
  });

  it('respects Gemini tool limits even with superAgent session tools', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Build me a full-stack app'],
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      undefined,
      { isSuperAgent: true, model: 'gemini-2.5-pro' },
    );
    expect(selected.length).toBeLessThanOrEqual(PROVIDER_TOOL_LIMITS.gemini);
  });

  it('preserves session tools even when restrictToPreferredTools is active', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Search for documentation'],
      'openai',
      undefined,
      undefined,
      {
        isSuperAgent: true,
        preferredToolNames: ['web_search', 'web_fetch'],
        restrictToPreferredTools: true,
      },
    );
    const selectedNames = new Set(selected.map((t) => t.name));

    // Preferred tools should be included
    expect(selectedNames.has('web_search')).toBe(true);

    // Session tools survive restrictToPreferredTools when isSuperAgent
    expect(selectedNames.has('sessions_spawn')).toBe(true);
    expect(selectedNames.has('sessions_output')).toBe(true);
    expect(selectedNames.has('sessions_surface_output')).toBe(true);
    expect(selectedNames.has('sessions_status')).toBe(true);
    expect(selectedNames.has('sessions_wait')).toBe(true);
    expect(selectedNames.has('sessions_cancel')).toBe(true);
    expect(selectedNames.has('sessions_yield')).toBe(true);
  });

  it('carries recent Gemini workflow tools across vague follow-up turns', () => {
    const selected = selectToolsForRequest(
      tools,
      ['Try again'],
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      undefined,
      {
        model: 'gemini-2.5-pro',
        recentToolNames: ['web_fetch'],
      },
    );
    const selectedNames = new Set(selected.map((tool) => tool.name));

    expect(selectedNames.has('web_fetch')).toBe(true);
  });

  it('gives session tools high priority when trimming to limit', () => {
    const selected = selectToolsForRequest(tools, ['Help me'], 'openai', undefined, undefined, {
      isSuperAgent: true,
    });
    const selectedNames = new Set(selected.map((t) => t.name));

    // Session tools should always survive trimming
    expect(selectedNames.has('sessions_spawn')).toBe(true);
    expect(selectedNames.has('sessions_output')).toBe(true);
    expect(selectedNames.has('sessions_surface_output')).toBe(true);
    expect(selectedNames.has('sessions_status')).toBe(true);
    expect(selectedNames.has('sessions_wait')).toBe(true);
  });
});
