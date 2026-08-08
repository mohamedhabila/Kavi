jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { resolveModelTurnGroundedToolSurface } from '../../src/engine/graph/modelTurn/resolveGroundedToolSurface';
import { buildUnauthorizedToolResult } from '../../src/engine/toolExecution/unauthorizedToolResult';
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

describe('a refusal now means permission, and says so honestly', () => {
  // The advertised surface no longer refuses anything: a registered, permitted tool runs
  // whenever it is called, because which capability a task needs only becomes clear while
  // doing the task. What remains here is a genuine permission boundary.
  it('names the tool and states the boundary as fixed', () => {
    const content = buildUnauthorizedToolResult('clipboard_read');

    expect(content).toContain('clipboard_read');
    expect(content).toContain('is not permitted in this run');
    expect(content).toContain('permission boundary');
  });

  it('does not send the model to discovery, which cannot widen a permission set', () => {
    // Traced live: naming `tool_catalog` here produced alternating rejected calls and
    // useless discovery calls until the run's iteration budget was gone.
    const content = buildUnauthorizedToolResult('clipboard_read');

    expect(content).not.toContain(TOOL_CATALOG_TOOL.name);
    expect(content).toContain('say what you cannot do and why');
  });

  it('is the only refusal preflight raises for tool permission', () => {
    const preflight = require('fs').readFileSync(
      'src/engine/toolExecution/toolCallLifecyclePreflight.ts',
      'utf8',
    );
    expect(preflight).not.toContain('is not allowed in this context');
    // One branch for the run allowlist, one for a conversation-mode restriction.
    expect(preflight.match(/buildUnauthorizedToolResult\(/g)).toHaveLength(2);
  });
});
