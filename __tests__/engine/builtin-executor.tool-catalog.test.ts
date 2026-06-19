import {
  executeToolCatalog,
  installBuiltinExecutorRuntimeReset,
} from '../helpers/builtinExecutorRuntimeHarness';

describe('builtin executor tool catalog', () => {
  installBuiltinExecutorRuntimeReset();

  describe('executeToolCatalog', () => {
    it('returns all categories when no filter', async () => {
      const result = await executeToolCatalog({});
      const parsed = JSON.parse(result);
      expect(parsed.categories).toBeDefined();
      expect(Array.isArray(parsed.categories)).toBe(true);
      expect(parsed.categories.length).toBeGreaterThan(0);
      expect(parsed.availableCategories).toBeUndefined();
      expect(parsed.categories[0].purpose).toBeUndefined();

      const categoryNames = parsed.categories.map((c: any) => c.category);
      expect(categoryNames).toContain('files');
      expect(categoryNames).toContain('browser');
      expect(categoryNames).toContain('workspace');
      expect(categoryNames).toContain('canvas');
      expect(categoryNames).toContain('sessions');
      expect(categoryNames).toContain('agents');
      expect(categoryNames).toContain('native');
      expect(categoryNames).toContain('media');
      expect(categoryNames).toContain('memory');
      expect(categoryNames).toContain('web');
      expect(categoryNames).toContain('code');
      expect(parsed.categories.every((entry: any) => entry.sampleTools.length <= 3)).toBe(true);
    });

    it('filters by category', async () => {
      const result = await executeToolCatalog({ category: 'canvas' });
      const parsed = JSON.parse(result);
      expect(parsed.category).toBe('canvas');
      expect(parsed.purpose).toContain('session canvas previews');
      expect(parsed.tools).toBeDefined();
      expect(parsed.tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'canvas_read' })]),
      );
    });

    it('returns browser tools when filtering by browser', async () => {
      const result = await executeToolCatalog({ category: 'browser' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('browser');
      expect(parsed.purpose).toContain('control websites interactively');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'browser_navigate' }),
          expect.objectContaining({ name: 'browser_click' }),
          expect.objectContaining({ name: 'browser_snapshot' }),
        ]),
      );
    });

    it('returns the full calendar mutation workflow when filtering by calendar', async () => {
      const result = await executeToolCatalog({ category: 'calendar' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('calendar');
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining([
          'calendar_list',
          'calendar_events',
          'calendar_create_event',
          'calendar_update_event',
        ]),
      );
    });

    it('ignores unsupported capability filters without hiding category matches', async () => {
      const result = await executeToolCatalog({
        category: 'calendar',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.capabilities).toEqual(['write']);
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
      expect(parsed.totalMatches).toBeGreaterThanOrEqual(2);
    });

    it('treats native catalog search as the structured device-resource family', async () => {
      const result = await executeToolCatalog({
        category: 'native',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBe('native');
      expect(parsed.capabilities).toEqual(['write']);
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
    });

    it('does not let unknown search categories suppress structural query matches', async () => {
      const result = await executeToolCatalog({
        category: 'mobile',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBeUndefined();
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
    });

    it('falls back to category matches when a natural query has no structural overlap', async () => {
      const result = await executeToolCatalog({
        category: 'calendar',
        query: 'schedule meeting',
        capabilities: ['write'],
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBe('calendar');
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
    });

    it('returns category workflow coverage for multi-capability discovery hints', async () => {
      const result = await executeToolCatalog({
        category: 'calendar',
        query: 'E2E Native Review Updated by E2E',
        capabilities: ['read', 'write', 'verify'],
      });
      const parsed = JSON.parse(result);
      const toolNames = parsed.tools.map((tool: any) => tool.name);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBe('calendar');
      expect(parsed.capabilities).toEqual(['read', 'write', 'verify']);
      expect(toolNames).toEqual(
        expect.arrayContaining([
          'calendar_list',
          'calendar_events',
          'calendar_create_event',
          'calendar_update_event',
        ]),
      );
    });

    it('returns the full category tool list without activation scaffolding', async () => {
      const result = await executeToolCatalog({ category: 'files' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('files');
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining([
          'read_file',
          'list_files',
          'glob_search',
          'text_search',
          'write_file',
          'file_edit',
        ]),
      );
      const readFile = parsed.tools.find((tool: any) => tool.name === 'read_file');
      expect(readFile.schemaDigest).toMatch(/^schema-fnv1a32:[0-9a-f]{8}$/);
      expect(readFile.input_schema).toBeUndefined();
      expect(parsed.activation).toBeUndefined();
    });

    it('returns both javascript and python when filtering by code', async () => {
      const result = await executeToolCatalog({ category: 'code' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('code');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'javascript' }),
          expect.objectContaining({ name: 'python' }),
        ]),
      );
    });

    it('returns both image generation and image editing when filtering by media', async () => {
      const result = await executeToolCatalog({ category: 'media' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('media');
      expect(parsed.purpose).toContain('generate, or edit media');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'image_generate' }),
          expect.objectContaining({ name: 'image_edit' }),
        ]),
      );
    });

    it('preserves the explicit category tool order for activation', async () => {
      const result = await executeToolCatalog({ category: 'expo' });
      const parsed = JSON.parse(result);
      const listedNames = parsed.tools.map((tool: any) => tool.name);

      expect(listedNames.slice(0, 4)).toEqual([
        'expo_eas_create_project',
        'expo_eas_list_projects',
        'expo_eas_status',
        'expo_eas_probe',
      ]);
    });

    it('classifies GitHub skill tools from explicit contracts instead of registry inference', async () => {
      const { getSkillToolDefinitions } = require('../../src/services/skills/manager');

      getSkillToolDefinitions.mockReturnValue([
        {
          name: 'skill__github__repos',
          description: '[GitHub] List repositories',
          contract: {
            category: 'github',
            capabilities: ['discover'],
            resourceKinds: ['github_repo'],
            sideEffects: ['none'],
            workflowStages: ['discover_resource'],
          },
        },
        {
          name: 'skill__github__commit_files',
          description: '[GitHub] Commit files',
          contract: {
            category: 'github',
            capabilities: ['write', 'commit', 'push'],
            resourceKinds: ['github_repo', 'github_branch', 'conversation_workspace'],
            sideEffects: ['remote_mutation'],
            workflowStages: ['persist_artifact', 'mutate_remote_state', 'verify_evidence'],
          },
        },
      ]);

      const result = await executeToolCatalog({ category: 'github' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('github');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'skill__github__repos' }),
          expect.objectContaining({ name: 'skill__github__commit_files' }),
        ]),
      );
      const listedNames = parsed.tools.map((tool: any) => tool.name);
      expect(listedNames.indexOf('skill__github__repos')).toBeLessThan(
        listedNames.indexOf('skill__github__commit_files'),
      );
    });

    it('returns a structured error for unknown categories', async () => {
      const result = await executeToolCatalog({ category: 'unknown' });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('Unknown tool_catalog category');
      expect(parsed.availableCategories).toContain('files');
      expect(parsed.availableCategories).toContain('browser');
    });

    it('includes connected MCP tools and installed skills in the catalog', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');
      const {
        useSkillsStore,
        getSkillToolDefinitions,
      } = require('../../src/services/skills/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'srv-1',
          name: 'Docs MCP',
          state: 'connected',
          tools: [{ name: 'search_docs', description: 'Search docs', inputSchema: {} }],
        },
      ]);
      useSkillsStore.getState.mockReturnValue({
        getEnabled: () => [
          {
            id: 'skill-1',
            enabled: true,
            installedAt: 1,
            metadata: {
              name: 'Weather Skill',
              description: 'Forecast helper',
              version: '1.0.0',
              invocationPolicy: 'auto',
              tools: [],
            },
            source: {
              source: 'clawhub',
              id: 'skill-1',
              url: 'https://clawhub.ai/api/v1/skills/skill-1/file?path=SKILL.md',
            },
          },
        ],
      });
      getSkillToolDefinitions.mockReturnValue([
        {
          name: 'skill__weather__forecast',
          description: '[Weather Skill] Forecast helper',
          input_schema: { type: 'object', properties: {} },
        },
      ]);

      const result = await executeToolCatalog({});
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('overview');
      expect(parsed.totalMcpTools).toBe(1);
      expect(parsed.totalSkills).toBe(1);
      expect(parsed.totalSkillTools).toBe(1);
      expect(parsed.categories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'mcp',
            sampleTools: ['mcp__srv-1__search_docs'],
          }),
          expect.objectContaining({
            category: 'skills',
            sampleTools: ['skill__weather__forecast'],
            skills: ['Weather Skill'],
          }),
        ]),
      );
    });

    it('returns detailed MCP and skills listings for dynamic categories', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');
      const {
        useSkillsStore,
        getSkillToolDefinitions,
      } = require('../../src/services/skills/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'srv-1',
          name: 'Docs MCP',
          state: 'connected',
          tools: [{ name: 'search_docs', description: 'Search docs', inputSchema: {} }],
        },
        {
          id: 'srv-2',
          name: 'Private MCP',
          state: 'error',
          tools: [],
          authRequired: true,
        },
      ]);
      useSkillsStore.getState.mockReturnValue({
        getEnabled: () => [
          {
            id: 'skill-1',
            enabled: true,
            installedAt: 1,
            metadata: {
              name: 'Weather Skill',
              description: 'Forecast helper',
              version: '1.0.0',
              invocationPolicy: 'manual',
              tools: [],
            },
            source: {
              source: 'clawhub',
              id: 'skill-1',
              url: 'https://clawhub.ai/api/v1/skills/skill-1/file?path=SKILL.md',
            },
          },
        ],
      });
      getSkillToolDefinitions.mockReturnValue([
        {
          name: 'skill__weather__forecast',
          description: '[Weather Skill] Forecast helper',
          input_schema: { type: 'object', properties: {} },
        },
      ]);

      const mcpResult = JSON.parse(await executeToolCatalog({ category: 'mcp' }));
      expect(mcpResult.mode).toBe('category');
      expect(mcpResult.tools).toEqual([
        expect.objectContaining({
          name: 'mcp__srv-1__search_docs',
          serverName: 'Docs MCP',
          schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
        }),
      ]);
      expect(mcpResult.pendingServers).toEqual([
        expect.objectContaining({
          name: 'Private MCP',
          authRequired: true,
        }),
      ]);

      const skillsResult = JSON.parse(await executeToolCatalog({ category: 'skills' }));
      expect(skillsResult.mode).toBe('category');
      expect(skillsResult.skills).toEqual([
        expect.objectContaining({
          name: 'Weather Skill',
          invocationPolicy: 'manual',
          location: 'skills/weather-skill-skill-1/SKILL.md',
        }),
      ]);
      expect(skillsResult.tools).toEqual([
        expect.objectContaining({
          name: 'skill__weather__forecast',
          schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
        }),
      ]);
    });

    it('marks MCP catalog results discoverable when the current tool policy hides dynamic tools', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'srv-1',
          name: 'Docs MCP',
          state: 'connected',
          tools: [{ name: 'search_docs', description: 'Search docs', inputSchema: {} }],
        },
      ]);

      const result = JSON.parse(
        await executeToolCatalog(
          { category: 'mcp' },
          { availableToolNames: new Set(['tool_catalog']) },
        ),
      );

      expect(result.category).toBe('mcp');
      expect(result.tools).toEqual([
        expect.objectContaining({
          name: 'mcp__srv-1__search_docs',
          schemaVersion: 'tool-catalog-entry-v1',
          schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
          activation: {
            name: 'mcp__srv-1__search_docs',
            eligible: true,
            callableNow: false,
            reason: 'discoverable',
          },
        }),
      ]);
    });
  });
});
