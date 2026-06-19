import {
  buildToolSurfaceTokenAuditDetail,
  GRAPH_OBSERVABILITY_AUDIT_TYPES,
} from '../../src/engine/graph/graphObservability';
import { buildToolSurfaceTokenAudit } from '../../src/engine/graph/toolSurfaceTokenAudit';
import type { ToolDefinition } from '../../src/types/tool';

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: 'First sentence. Second sentence. Third sentence.',
    input_schema: { type: 'object', properties: {} },
    contract: { capabilities: ['demo.capability'] },
  };
}

describe('toolSurfaceTokenAudit', () => {
  it('reports selected count, token estimate, and evicted tool names', () => {
    const candidateTools = [
      makeTool('read_file'),
      makeTool('extra_tool'),
      makeTool('mcp__docs__search'),
    ];
    const retainedTools = [makeTool('read_file')];

    const audit = buildToolSurfaceTokenAudit({ candidateTools, retainedTools });

    expect(audit.selectedCount).toBe(1);
    expect(audit.estimatedTokens).toBeGreaterThan(0);
    expect(audit.evictedToolNames).toEqual(['extra_tool', 'mcp__docs__search']);
    expect(audit.sessionPinnedCount).toBe(0);
    expect(audit.turnPinnedCount).toBe(0);
    expect(buildToolSurfaceTokenAuditDetail(audit)).toContain(
      'evicted:extra_tool,mcp__docs__search',
    );
    expect(buildToolSurfaceTokenAuditDetail(audit)).toContain('sessionPinned:0,turnPinned:0');
  });

  it('uses the dedicated graph observability audit type', () => {
    expect(GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_TOKEN_AUDIT).toBe(
      'TOOL_SURFACE_TOKEN_AUDIT',
    );
  });
});
