import { resolveAuthorizedToolNames } from '../../src/engine/goals/toolSurfaceAuthority';
import { buildUnknownToolResult } from '../../src/engine/toolExecution/unknownToolSuggestion';
import { buildUnauthorizedToolResult } from '../../src/engine/toolExecution/unauthorizedToolResult';
import { tools } from '../helpers/turnToolSurfaceHarness';
import type { ToolDefinition } from '../../src/types/tool';

// Traced live on an Android emulator. A turn's advertised surface was also its permission
// list, so a registered, permitted tool the previous turn had not predicted was refused —
// and the refusal named `tool_catalog` as the way back. A feasibility study needing Monte
// Carlo called `python`, was told to discover it first, and the discovery call never
// returned. A capability the run held throughout became permanently unreachable, and the
// run failed. Which capability a task needs is not knowable before the work is under way,
// so a guess about it must not be able to refuse a call.

const calendarCreateEvent: ToolDefinition = {
  name: 'calendar_create_event',
  description: 'Create a calendar event.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'calendar',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['remote_mutation'],
  },
};

const smsCompose: ToolDefinition = {
  name: 'sms_compose',
  description: 'Compose a text message.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['remote_mutation'],
  },
};

const reminderCreate: ToolDefinition = {
  name: 'reminder',
  description: 'Create a reminder.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'reminders',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
  },
};

const sshExec: ToolDefinition = {
  name: 'ssh_exec',
  description: 'Run a command over SSH.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'ssh',
    capabilities: ['compute'],
    resourceKinds: ['unknown'],
    sideEffects: ['external_run'],
  },
};

const openWorldMutatingTool: ToolDefinition = {
  name: 'mcp__web__automate',
  description: 'Drive an arbitrary web session on the caller\'s behalf.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'automation',
    capabilities: ['write'],
    resourceKinds: ['unknown'],
    sideEffects: ['external_run'],
    riskHints: ['open_world'],
  },
};

const allTools: ToolDefinition[] = [
  ...tools,
  calendarCreateEvent,
  smsCompose,
  reminderCreate,
  sshExec,
  openWorldMutatingTool,
];

describe('an agentic run states its authority through permission, not presentation', () => {
  it('imposes no separate mode restriction', () => {
    // Empty means "no mode restriction applies", so the run allowlist and memory policy —
    // already enforced before this is consulted — remain the whole answer. Enumerating a
    // second set here could only disagree with them, and tools reach the surface from
    // registries this list cannot see.
    expect(resolveAuthorizedToolNames({ allTools }).size).toBe(0);
    expect(resolveAuthorizedToolNames({ allTools, conversationMode: 'agentic' }).size).toBe(0);
  });
});

describe('chitchat authority is decided by contract, not a maintained tool-name list', () => {
  const chitchat = () => resolveAuthorizedToolNames({ allTools, conversationMode: 'chitchat' });

  it('authorizes everyday actions outside any agentic-only category', () => {
    const authorized = chitchat();

    expect(authorized.has('calendar_create_event')).toBe(true);
    expect(authorized.has('sms_compose')).toBe(true);
    expect(authorized.has('reminder')).toBe(true);
    expect(authorized.has('memory_recall')).toBe(true);
    expect(authorized.has('memory_remember')).toBe(true);
  });

  it('refuses every agentic-only category regardless of the tool name', () => {
    const authorized = chitchat();

    expect(authorized.has('sessions_spawn')).toBe(false);
    expect(authorized.has('update_goals')).toBe(false);
    expect(authorized.has('ssh_exec')).toBe(false);
    expect(authorized.has('python')).toBe(false);
  });

  it('refuses an open-world tool that can also mutate what it reaches', () => {
    // Not a category exclusion — riskHints alone gates this one, and it carries no
    // `read_only` hint to carve it back in the way `web_search`/`web_fetch` are.
    expect(chitchat().has('mcp__web__automate')).toBe(false);
  });

  it('permits discovery, which mutates nothing and lets the mode notice it was outgrown', () => {
    expect(chitchat().has('tool_catalog')).toBe(true);
    expect(chitchat().has('tool_describe')).toBe(true);
  });

  it('honours a code-owned explicit pin', () => {
    const authorized = resolveAuthorizedToolNames({
      allTools,
      conversationMode: 'chitchat',
      explicitToolSurfaceToolNames: ['mobile_ui_action'],
    });
    expect(authorized.has('mobile_ui_action')).toBe(true);
  });
});

describe('the refusal messages match what the model can actually do about them', () => {
  it('states a permission boundary as fixed, without offering discovery', () => {
    const message = buildUnauthorizedToolResult('sessions_spawn');

    expect(message).toContain('is not permitted in this run');
    // Discovery cannot widen a permission set; naming it sent runs into a useless loop.
    expect(message).not.toContain('tool_catalog');
  });

  it('answers an unknown tool with the nearest real one and its contract', () => {
    const message = buildUnknownToolResult({ toolName: 'read_files' });

    expect(message).toContain('Did you mean "read_file"?');
    expect(message).toContain('input_schema');
    // Discovery is a fallback here, because the model may genuinely want something else.
    expect(message).toContain('tool_catalog');
  });

  it('does not invent a suggestion for a name nothing resembles', () => {
    const message = buildUnknownToolResult({ toolName: 'zzzz_quantum_flux_capacitor' });

    expect(message).toContain('no registered tool has a similar name');
    expect(message).not.toContain('Did you mean');
  });

  it('never suggests a tool the run cannot call', () => {
    const message = buildUnknownToolResult({
      toolName: 'read_files',
      availableToolNames: new Set(['memory_recall']),
    });

    expect(message).not.toContain('read_file"');
  });
});
