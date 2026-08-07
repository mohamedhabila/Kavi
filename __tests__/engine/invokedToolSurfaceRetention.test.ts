jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { resolveModelTurnGroundedToolSurface } from '../../src/engine/graph/modelTurn/resolveGroundedToolSurface';
import { buildOffSurfaceToolResult } from '../../src/engine/toolExecution/offSurfaceToolResult';
import { TOOL_CATALOG_TOOL } from '../../src/engine/tools/builtin-definitions-coordination';
import type { ToolDefinition } from '../../src/types/tool';

function nativeTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'custom',
      capabilities: ['read'],
      resourceKinds: ['device'],
      sideEffects: [],
    },
  };
}

// Traced live on `direct-spabench-cross-app-device-actions`: `clipboard` returned
// successfully, was evicted from the surface under tool-token pressure, and the
// identical call was then rejected four more times. Eviction did not save a
// round-trip — it spent several, because the model had to rediscover the tool.
const clipboardRead = nativeTool('clipboard_read');
const clipboardWrite = nativeTool('clipboard_write');
const shareText = nativeTool('share_text');

describe('tool surface retains tools the run already invoked', () => {
  it('pins an invoked tool so budget pressure cannot evict it', async () => {
    const resolution = await resolveModelTurnGroundedToolSurface({
      allTools: [clipboardRead, clipboardWrite, shareText],
      conversationMode: 'agentic',
      completedWorkflowToolNames: new Set([clipboardRead.name]),
      explicitToolSurfaceToolNames: [clipboardRead.name, clipboardWrite.name, shareText.name],
      trackedAsyncOperations: new Map(),
      sessionActivatedToolNames: [clipboardRead.name, clipboardWrite.name, shareText.name],
      workingMessages: [],
    });

    expect(resolution.pinnedToolNames).toContain(clipboardRead.name);
  });

  it('does not pin a tool that is merely available but never invoked', async () => {
    // The signal is demonstrated use, not presence. Pinning everything on the surface
    // would make the token budget unenforceable.
    const resolution = await resolveModelTurnGroundedToolSurface({
      allTools: [clipboardRead, clipboardWrite, shareText],
      conversationMode: 'agentic',
      completedWorkflowToolNames: new Set([clipboardRead.name]),
      explicitToolSurfaceToolNames: [clipboardRead.name, clipboardWrite.name, shareText.name],
      trackedAsyncOperations: new Map(),
      sessionActivatedToolNames: [clipboardRead.name, clipboardWrite.name, shareText.name],
      workingMessages: [],
    });

    expect(resolution.pinnedToolNames).not.toContain(shareText.name);
  });

  it('never pins an invoked tool that has left the grounded surface', async () => {
    // A tool the policy layer removed must not be resurrected by having been used.
    const resolution = await resolveModelTurnGroundedToolSurface({
      allTools: [clipboardWrite],
      conversationMode: 'agentic',
      completedWorkflowToolNames: new Set([clipboardRead.name]),
      explicitToolSurfaceToolNames: [clipboardWrite.name],
      trackedAsyncOperations: new Map(),
      sessionActivatedToolNames: [clipboardWrite.name],
      workingMessages: [],
    });

    expect(resolution.pinnedToolNames).not.toContain(clipboardRead.name);
  });
});

describe('off-surface tool rejection states a recovery', () => {
  it('tells the model the tool exists and how to bring it back', () => {
    const content = buildOffSurfaceToolResult('clipboard_read');

    expect(content).toContain('clipboard_read');
    expect(content).toContain('registered for this run');
    expect(content).toContain(TOOL_CATALOG_TOOL.name);
  });

  it('says plainly that repeating the identical call will fail the same way', () => {
    // This sentence is the whole point: without it the cheapest next move the model
    // has is another identical call, which is exactly what the live trace showed.
    expect(buildOffSurfaceToolResult('clipboard_read')).toContain(
      'Repeating this call unchanged',
    );
  });

  it('is the content both off-surface preflight branches return', () => {
    // The filter branch and the grounded-surface branch describe the same situation,
    // so neither may drift back to a dead-end message.
    const preflight = require('fs').readFileSync(
      'src/engine/toolExecution/toolCallLifecyclePreflight.ts',
      'utf8',
    );
    expect(preflight).not.toContain('is not allowed in this context');
    expect(preflight.match(/buildOffSurfaceToolResult\(/g)).toHaveLength(2);
  });
});
