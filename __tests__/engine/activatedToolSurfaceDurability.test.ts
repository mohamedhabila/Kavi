import { resolveTurnToolSurface } from '../../src/engine/tools/toolSurface';
import { CORE_DOMAIN_TOOLS } from '../../src/engine/tools/domains/core';
import { tools } from '../helpers/turnToolSurfaceHarness';
import type { ToolDefinition } from '../../src/types/tool';

// Traced live on an Android emulator: a feasibility study activated `python` through
// `tool_catalog`, ran it once, and could never call it again, because the surface re-judged
// activations every turn against what had already run. The run alternated rejected `python`
// calls and useless `tool_catalog` calls until its iteration budget ran out. Tools the
// conversation brought onto the surface now stay there.

const pythonTool = (CORE_DOMAIN_TOOLS as ToolDefinition[]).find((tool) => tool.name === 'python');

if (!pythonTool) {
  throw new Error('python tool definition is required for this test');
}

const pureMutator: ToolDefinition = {
  name: 'workspace_note_write',
  description: 'Write a non-core workspace note.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'workspace_files',
    capabilities: ['write'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['local_artifact'],
  },
};

const allTools: ToolDefinition[] = [...tools, pythonTool, pureMutator];

function surfaceNames(conversationToolNames: string[]): string[] {
  return resolveTurnToolSurface({ allTools, conversationToolNames }).map((tool) => tool.name);
}

describe('a tool the conversation brought onto the surface stays there', () => {
  it('keeps python after it has run, however often it runs', () => {
    expect(surfaceNames(['python'])).toContain('python');
    expect(surfaceNames(['python', 'write_file', 'read_file'])).toContain('python');
  });

  it('keeps a mutator after its write landed; its approval still gates each call', () => {
    expect(surfaceNames(['workspace_note_write'])).toContain('workspace_note_write');
  });

  it('ignores a name that is not a registered tool', () => {
    expect(surfaceNames(['no_such_tool'])).not.toContain('no_such_tool');
  });

  it('only grows at its end: a newly added tool leaves every earlier position as it was', () => {
    const before = surfaceNames(['python']);
    const after = surfaceNames(['python', 'workspace_note_write']);

    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe('workspace_note_write');
  });
});
