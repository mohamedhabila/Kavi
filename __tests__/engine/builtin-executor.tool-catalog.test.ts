import {
  executeToolCatalog,
  installBuiltinExecutorRuntimeReset,
} from '../helpers/builtinExecutorRuntimeHarness';
import { parseCompletedToolOutcome, parseFailedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('builtin executor tool catalog', () => {
  installBuiltinExecutorRuntimeReset();

  describe('executeToolCatalog', () => {
    it('returns only categories backed by visible registered tools', async () => {
      const result = await executeToolCatalog({});
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.categories).toBeDefined();
      expect(Array.isArray(parsed.categories)).toBe(true);
      expect(parsed.categories.length).toBeGreaterThan(0);
      expect(parsed.availableCategories).toBeUndefined();
      expect(parsed.categories[0].purpose).toBeUndefined();

      const categoryNames = parsed.categories.map((c: any) => c.category);
      expect(categoryNames).toContain('files');
      expect(categoryNames).toContain('browser');
      expect(categoryNames).toContain('canvas');
      expect(categoryNames).toContain('native');
      expect(categoryNames).toContain('notifications');
      expect(categoryNames).toContain('media');
      expect(categoryNames).toContain('web');
      expect(categoryNames).toContain('code');
      expect(categoryNames).not.toContain('workspace');
      expect(categoryNames).not.toContain('sessions');
      expect(categoryNames).not.toContain('agents');
      expect(categoryNames).not.toContain('memory');
      expect(parsed.categories.every((entry: any) => entry.sampleTools.length <= 3)).toBe(true);
    });

    it('filters by category', async () => {
      const result = await executeToolCatalog({ category: 'canvas' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.category).toBe('canvas');
      expect(parsed.purpose).toContain('session canvas previews');
      expect(parsed.tools).toBeDefined();
      expect(parsed.tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'canvas_read' })]),
      );
    });

    it('returns browser tools when filtering by browser', async () => {
      const result = await executeToolCatalog({ category: 'browser' });
      const parsed = parseCompletedToolOutcome(result);

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
      const parsed = parseCompletedToolOutcome(result);

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

    it('returns the complete notification lifecycle when filtering by notifications', async () => {
      const result = await executeToolCatalog({ category: 'notifications' });
      const parsed = parseCompletedToolOutcome(result);

      expect(parsed.category).toBe('notifications');
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual([
        'notification_send',
        'notification_schedule',
        'notification_cancel',
      ]);
    });

    it('ignores unsupported capability filters without hiding category matches', async () => {
      const result = await executeToolCatalog({
        category: 'calendar',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = parseCompletedToolOutcome(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.capabilities).toEqual(['write']);
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
      expect(parsed.totalMatches).toBeGreaterThanOrEqual(2);
    });

    it('uses explicit native catalog membership without leaking unrelated device automation', async () => {
      const result = await executeToolCatalog({
        category: 'native',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = parseCompletedToolOutcome(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBe('native');
      expect(parsed.capabilities).toEqual(['write']);
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
      expect(parsed.tools.map((tool: any) => tool.name)).not.toContain('cron');
    });

    it('does not let unknown search categories suppress structural query matches', async () => {
      const result = await executeToolCatalog({
        category: 'mobile',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = parseCompletedToolOutcome(result);

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
      const parsed = parseCompletedToolOutcome(result);

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
      const parsed = parseCompletedToolOutcome(result);
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
      const parsed = parseCompletedToolOutcome(result);

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
      const parsed = parseCompletedToolOutcome(result);

      expect(parsed.category).toBe('code');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'javascript' }),
          expect.objectContaining({ name: 'python' }),
        ]),
      );
    });

    it('returns user-mediated selection, image generation, and image editing for media', async () => {
      const result = await executeToolCatalog({ category: 'media' });
      const parsed = parseCompletedToolOutcome(result);

      expect(parsed.category).toBe('media');
      expect(parsed.purpose).toContain('Select, inspect, capture');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'photos_pick' }),
          expect.objectContaining({ name: 'image_generate' }),
          expect.objectContaining({ name: 'image_edit' }),
        ]),
      );
    });

    it('discovers the system photo picker from a media read request', async () => {
      const result = await executeToolCatalog({
        category: 'media',
        query: 'photos_pick',
        capabilities: ['read', 'coordinate'],
      });
      const parsed = parseCompletedToolOutcome(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'photos_pick' })]),
      );
    });

    it('preserves the explicit category tool order for activation', async () => {
      const result = await executeToolCatalog({ category: 'expo' });
      const parsed = parseCompletedToolOutcome(result);
      const listedNames = parsed.tools.map((tool: any) => tool.name);

      expect(listedNames.slice(0, 4)).toEqual([
        'expo_eas_create_project',
        'expo_eas_list_projects',
        'expo_eas_status',
        'expo_eas_probe',
      ]);
    });

    it('does not trust runtime skill declarations to self-promote into GitHub capabilities', async () => {
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
      const parsed = parseCompletedToolOutcome(result);

      expect(parsed.category).toBe('github');
      expect(parsed.tools).toEqual([]);

      const skillsResult = await executeToolCatalog({ category: 'skills' });
      const skills = parseCompletedToolOutcome(skillsResult);
      expect(skills.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'skill__github__repos' }),
          expect.objectContaining({ name: 'skill__github__commit_files' }),
        ]),
      );
      const listedNames = skills.tools.map((tool: any) => tool.name);
      expect(listedNames.indexOf('skill__github__repos')).toBeLessThan(
        listedNames.indexOf('skill__github__commit_files'),
      );
    });

    it('returns a structured error for unknown categories', async () => {
      const result = await executeToolCatalog({ category: 'unknown' });
      const parsed = parseFailedToolOutcome(result);

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
      const parsed = parseCompletedToolOutcome(result);

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

      const mcpResult = parseCompletedToolOutcome(await executeToolCatalog({ category: 'mcp' }));
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

      const skillsResult = parseCompletedToolOutcome(
        await executeToolCatalog({ category: 'skills' }),
      );
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

    it('keeps dynamic MCP searches inside the requested integration category', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'trip-ledger',
          name: 'Trip Ledger',
          state: 'connected',
          tools: [
            {
              name: 'get_trip_record',
              description: 'Read one booking record',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'put_trip_note',
              description: 'Update one booking note',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ]);

      const result = parseCompletedToolOutcome(
        await executeToolCatalog({
          category: 'mcp',
          query: 'Trip Ledger booking read update',
          capabilities: ['discover', 'read', 'write', 'verify'],
        }),
      );

      expect(result.category).toBe('mcp');
      expect(result.tools.map((tool: any) => tool.name)).toEqual([
        'mcp__trip-ledger__get_trip_record',
        'mcp__trip-ledger__put_trip_note',
      ]);
      expect(result.tools.every((tool: any) => tool.category === 'mcp')).toBe(true);
    });

    it('keeps an empty dynamic category search inside its requested boundary', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'trip-ledger',
          name: 'Trip Ledger',
          state: 'connected',
          tools: [
            {
              name: 'get_trip_record',
              description: 'Read one booking record',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ]);

      const result = parseCompletedToolOutcome(
        await executeToolCatalog({
          category: 'skills',
          query: 'Trip Ledger booking pickup note',
          capabilities: ['discover', 'read', 'write'],
        }),
      );

      expect(result).toMatchObject({
        mode: 'search',
        category: 'skills',
        tools: [],
        totalMatches: 0,
        recovery: {
          searchWithoutCategory: true,
          suggestedCategories: expect.arrayContaining(['mcp']),
        },
      });
    });

    it('preserves trusted MCP contracts while searching dynamic tools', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'trip-ledger',
          name: 'Trip Ledger',
          state: 'connected',
          tools: [
            { name: 'get_trip_record', description: 'Read one booking record' },
            { name: 'put_trip_note', description: 'Update one booking note' },
          ],
        },
      ]);
      mcpManager.getAllToolDefinitions.mockReturnValue([
        {
          name: 'mcp__trip-ledger__get_trip_record',
          description: '[Trip Ledger] Read one booking record',
          input_schema: { type: 'object', properties: {} },
          contract: {
            category: 'mcp',
            capabilities: ['read'],
            resourceKinds: ['unknown'],
            sideEffects: ['none'],
            riskHints: ['trusted_metadata', 'read_only'],
            workflowStages: ['inspect_resource'],
          },
        },
        {
          name: 'mcp__trip-ledger__put_trip_note',
          description: '[Trip Ledger] Update one booking note',
          input_schema: { type: 'object', properties: {} },
          contract: {
            category: 'mcp',
            capabilities: ['write'],
            resourceKinds: ['unknown'],
            sideEffects: ['remote_mutation'],
            riskHints: ['trusted_metadata', 'idempotent'],
            workflowStages: ['mutate_remote_state'],
          },
        },
      ]);

      const result = parseCompletedToolOutcome(
        await executeToolCatalog({
          category: 'mcp',
          query: 'Trip Ledger booking',
          capabilities: ['write'],
        }),
      );

      expect(result.relaxedFilters).toEqual(['capabilities']);
      expect(result.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'mcp__trip-ledger__get_trip_record',
            category: 'mcp',
            capabilitySummary: expect.objectContaining({
              capabilities: ['read'],
              sideEffects: ['none'],
              workflowStages: ['inspect_resource'],
            }),
          }),
          expect.objectContaining({
            name: 'mcp__trip-ledger__put_trip_note',
            category: 'mcp',
            capabilitySummary: expect.objectContaining({
              capabilities: ['write'],
              resourceKinds: ['unknown'],
              sideEffects: ['remote_mutation'],
              workflowStages: ['mutate_remote_state'],
            }),
          }),
        ]),
      );
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

      const result = parseCompletedToolOutcome(
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

    it('removes unauthorized dynamic tools from catalog payloads', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'srv-1',
          name: 'Docs MCP',
          state: 'connected',
          tools: [{ name: 'search_docs', description: 'Search docs', inputSchema: {} }],
        },
      ]);

      const result = parseCompletedToolOutcome(
        await executeToolCatalog(
          { category: 'mcp' },
          { visibleToolNames: new Set(['tool_catalog']) },
        ),
      );

      expect(result.tools).toEqual([]);
      expect(result.servers).toEqual([
        expect.objectContaining({ id: 'srv-1', toolCount: 0, tools: [] }),
      ]);
      expect(JSON.stringify(result)).not.toContain('mcp__srv-1__search_docs');
    });
  });
});
