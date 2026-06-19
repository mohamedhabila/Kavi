import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';
import {
  searchToolCatalogEntries,
  tokenizeStructuralIdentifiers,
} from '../../src/engine/tools/builtin-tool-catalogSearch';

describe('builtin-tool-catalogSearch', () => {
  it('tokenizes structural identifiers without English heuristics', () => {
    expect(tokenizeStructuralIdentifiers('memory_recall read-verify')).toEqual([
      'memory_recall',
      'read',
      'verify',
    ]);
  });

  it('searches tools by query tokens and capability filters', () => {
    const matches = searchToolCatalogEntries({
      query: 'memory_recall',
      capabilities: ['read'],
      limit: 10,
    });

    expect(matches.some((tool) => tool.name === 'memory_recall')).toBe(true);
    expect(matches.every((tool) => tool.capabilitySummary?.capabilities.includes('read'))).toBe(
      true,
    );
  });

  it('returns exact structural identifier unions for multi-tool queries', () => {
    const matches = searchToolCatalogEntries({
      query: 'contacts_search sms_compose',
      capabilities: ['read', 'write'],
      limit: 10,
    });

    expect(matches.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['contacts_search', 'sms_compose']),
    );
  });

  it('ranks structurally related identifier tokens without natural-language task routes', () => {
    const matches = searchToolCatalogEntries({
      query: 'agent coordination',
      limit: 5,
    });

    expect(matches[0]?.name).toBe('agents');
  });

  it('resolves near category identifiers structurally', async () => {
    const result = await executeToolCatalog({ category: 'agent' });
    const parsed = JSON.parse(result);

    expect(parsed).toMatchObject({
      mode: 'category',
      category: 'agents',
    });
    expect(parsed.tools.some((tool: { name: string }) => tool.name === 'agents')).toBe(true);
  });

  it('returns search mode payload from tool_catalog execution', async () => {
    const result = await executeToolCatalog({
      query: 'pdf_read',
      capabilities: ['read'],
    });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe('search');
    expect(parsed.query).toBe('pdf_read');
    expect(parsed.capabilities).toEqual(['read']);
    expect(parsed.tools.some((tool: { name: string }) => tool.name === 'pdf_read')).toBe(true);
  });

  it('falls back to capability matches when a search query has no structural overlap', async () => {
    const result = await executeToolCatalog({
      query: 'worker-chain evidence handoff',
      capabilities: ['coordinate'],
    });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe('search');
    expect(parsed.capabilities).toEqual(['coordinate']);
    expect(parsed.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['sessions_spawn']),
    );
  });

  it('does not rank persona management as delegated work coordination', async () => {
    const result = await executeToolCatalog({
      query: 'agent coordination',
      capabilities: ['coordinate'],
    });
    const parsed = JSON.parse(result);
    const toolNames = parsed.tools.map((tool: { name: string }) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining(['sessions_spawn']));
    expect(toolNames).not.toContain('agents');
  });

  it('keeps category read tools in write-focused category discovery', async () => {
    const result = await executeToolCatalog({
      category: 'calendar',
      capabilities: ['write'],
    });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe('search');
    expect(parsed.category).toBe('calendar');
    expect(parsed.capabilities).toEqual(['write']);
    expect(parsed.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        'calendar_list',
        'calendar_events',
        'calendar_create_event',
        'calendar_update_event',
      ]),
    );
  });

  it('discovers delegation tools from declared metadata without capability hints', async () => {
    const result = await executeToolCatalog({
      query: 'delegated worker workstream evidence',
    });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe('search');
    expect(parsed.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['sessions_spawn']),
    );
  });

  it('indexes schema field names as structural catalog search tokens', async () => {
    const result = await executeToolCatalog({
      query: 'waitForCompletion workstreamId',
    });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe('search');
    expect(parsed.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['sessions_spawn']),
    );
  });

  it('searches the full discoverable registry when only catalog is currently callable', async () => {
    const result = await executeToolCatalog(
      {
        query: 'memory_recall',
        capabilities: ['read'],
      },
      { availableToolNames: new Set(['tool_catalog']) },
    );
    const parsed = JSON.parse(result);
    const memoryRecall = parsed.tools.find(
      (tool: { name: string }) => tool.name === 'memory_recall',
    );

    expect(memoryRecall).toMatchObject({
      name: 'memory_recall',
      source: 'built-in',
      schemaVersion: 'tool-catalog-entry-v1',
      activation: {
        name: 'memory_recall',
        eligible: true,
        callableNow: false,
        reason: 'discoverable',
      },
    });
  });

  it('marks catalog results callable when they are already on the current surface', async () => {
    const result = await executeToolCatalog(
      {
        query: 'memory_recall',
        capabilities: ['read'],
      },
      { availableToolNames: new Set(['tool_catalog', 'memory_recall']) },
    );
    const parsed = JSON.parse(result);
    const memoryRecall = parsed.tools.find(
      (tool: { name: string }) => tool.name === 'memory_recall',
    );

    expect(memoryRecall.activation).toMatchObject({
      name: 'memory_recall',
      eligible: true,
      callableNow: true,
      reason: 'callable_now',
    });
  });
});
