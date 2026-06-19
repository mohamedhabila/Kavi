import {
  executeSkillTool,
  filterToolsByInvocationPolicy,
  getAllLoadedSkills,
  getLoadedSkill,
  getSkillToolDefinitions,
  parseSkillToolName,
  registerSkill,
  resetSkillsManagerTestState,
  unregisterSkill,
} from '../helpers/skillsManagerHarness';
import type { Skill, ToolDefinition } from '../helpers/skillsManagerHarness';

beforeEach(resetSkillsManagerTestState);

describe('Skill Registration', () => {
  const skill: Skill = {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'For testing',
    version: '1.0.0',
    tools: [
      {
        name: 'greet',
        description: 'Greets a person',
        input_schema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        handler: async (args: any) => `Hello, ${args.name}!`,
      },
    ],
  };

  it('registerSkill / getLoadedSkill', () => {
    registerSkill(skill);
    const loaded = getLoadedSkill('test-skill');
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('Test Skill');
  });

  it('getAllLoadedSkills returns all', () => {
    registerSkill(skill);
    registerSkill({ ...skill, id: 'skill-2', name: 'Second' });
    expect(getAllLoadedSkills()).toHaveLength(2);
  });

  it('unregisterSkill removes skill', () => {
    registerSkill(skill);
    unregisterSkill('test-skill');
    expect(getLoadedSkill('test-skill')).toBeUndefined();
  });
});

describe('getSkillToolDefinitions', () => {
  it('returns namespaced tool definitions', () => {
    const skill: Skill = {
      id: 'my-skill',
      name: 'My Skill',
      description: 'desc',
      version: '1.0',
      tools: [
        {
          name: 'do_thing',
          description: 'Does a thing',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    };
    registerSkill(skill);

    const defs = getSkillToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('skill__my-skill__do_thing');
    expect(defs[0].description).toContain('[My Skill]');
  });

  it('preserves strict tool metadata', () => {
    const skill: Skill = {
      id: 'strict-skill',
      name: 'Strict Skill',
      description: 'desc',
      version: '1.0',
      tools: [
        {
          name: 'write_repo',
          description: 'Writes to a repo',
          strict: true,
          input_schema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
            },
            required: ['repo'],
            additionalProperties: false,
          },
        },
      ],
    };
    registerSkill(skill);

    const defs = getSkillToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].strict).toBe(true);
    expect(defs[0].input_schema.additionalProperties).toBe(false);
  });

  it('returns empty for no loaded skills', () => {
    expect(getSkillToolDefinitions()).toEqual([]);
  });
});

describe('parseSkillToolName', () => {
  it('parses valid skill tool name', () => {
    const result = parseSkillToolName('skill__my-skill__do_thing');
    expect(result).toEqual({ skillId: 'my-skill', toolName: 'do_thing' });
  });

  it('returns null for invalid format', () => {
    expect(parseSkillToolName('not_a_skill_tool')).toBeNull();
    expect(parseSkillToolName('skill__only_two')).toBeNull();
    expect(parseSkillToolName('mcp__server__tool')).toBeNull();
  });
});

describe('executeSkillTool', () => {
  it('executes a valid skill tool', async () => {
    const skill: Skill = {
      id: 'exec-skill',
      name: 'Exec',
      description: '',
      version: '1.0',
      tools: [
        {
          name: 'greet',
          description: 'Greets',
          input_schema: { type: 'object', properties: {} },
          handler: async (args: any) => `Hi ${args.name}`,
        },
      ],
    };
    registerSkill(skill);

    const result = await executeSkillTool(
      'skill__exec-skill__greet',
      JSON.stringify({ name: 'World' }),
    );
    expect(result).toBe('Hi World');
  });

  it('passes execution context to the handler', async () => {
    registerSkill({
      id: 'ctx-skill',
      name: 'Context',
      description: '',
      version: '1.0',
      tools: [
        {
          name: 'inspect',
          description: 'Reads execution context',
          input_schema: { type: 'object', properties: {} },
          handler: async (_args, context) =>
            JSON.stringify({
              conversationId: context.conversationId,
              fileContent: await context.readConversationFile?.('note.txt'),
            }),
        },
      ],
    });

    const result = await executeSkillTool('skill__ctx-skill__inspect', '{}', {
      conversationId: 'conv-ctx',
      readConversationFile: async () => 'workspace note',
    });

    expect(JSON.parse(result)).toEqual({
      conversationId: 'conv-ctx',
      fileContent: 'workspace note',
    });

    unregisterSkill('ctx-skill');
  });

  it('returns error for invalid tool name', async () => {
    const result = await executeSkillTool('bad_name', '{}');
    expect(result).toContain('Error');
  });

  it('returns error for unloaded skill', async () => {
    const result = await executeSkillTool('skill__missing__tool', '{}');
    expect(result).toContain('not loaded');
  });

  it('returns error for missing tool in skill', async () => {
    registerSkill({
      id: 'empty-skill',
      name: 'Empty',
      description: '',
      version: '1.0',
      tools: [],
    });
    const result = await executeSkillTool('skill__empty-skill__missing', '{}');
    expect(result).toContain('not found');
  });

  it('returns error for invalid JSON args', async () => {
    registerSkill({
      id: 'json-skill',
      name: 'JSON',
      description: '',
      version: '1.0',
      tools: [
        {
          name: 'test',
          description: 'Test',
          input_schema: { type: 'object', properties: {} },
          handler: async () => 'ok',
        },
      ],
    });
    const result = await executeSkillTool('skill__json-skill__test', 'not-json');
    expect(result).toContain('invalid');
  });

  it('returns error when handler is missing', async () => {
    registerSkill({
      id: 'no-handler',
      name: 'NoHandler',
      description: '',
      version: '1.0',
      tools: [
        {
          name: 'test',
          description: 'test',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    });
    const result = await executeSkillTool('skill__no-handler__test', '{}');
    expect(result).toContain('no handler');
  });

  it('catches handler errors', async () => {
    registerSkill({
      id: 'err-skill',
      name: 'Error',
      description: '',
      version: '1.0',
      tools: [
        {
          name: 'boom',
          description: 'Explodes',
          input_schema: { type: 'object', properties: {} },
          handler: async () => {
            throw new Error('Boom!');
          },
        },
      ],
    });
    const result = await executeSkillTool('skill__err-skill__boom', '{}');
    expect(result).toContain('Boom!');
  });
});

describe('filterToolsByInvocationPolicy', () => {
  const nonSkillTool: ToolDefinition = {
    name: 'read_file',
    description: 'Read a file',
    input_schema: { type: 'object', properties: {} },
  };

  beforeEach(() => {
    registerSkill({
      id: 'auto-skill',
      name: 'Auto Skill',
      description: '',
      version: '1.0',
      tools: [
        { name: 'auto_tool', description: '', input_schema: { type: 'object', properties: {} } },
      ],
      invocationPolicy: 'auto',
    });
    registerSkill({
      id: 'manual-skill',
      name: 'Manual Skill',
      description: '',
      version: '1.0',
      tools: [
        { name: 'manual_tool', description: '', input_schema: { type: 'object', properties: {} } },
      ],
      invocationPolicy: 'manual',
    });
    registerSkill({
      id: 'agent-skill',
      name: 'Agent Skill',
      description: '',
      version: '1.0',
      tools: [
        { name: 'agent_tool', description: '', input_schema: { type: 'object', properties: {} } },
      ],
      invocationPolicy: 'agent-decides',
    });
  });

  const allTools: ToolDefinition[] = [
    nonSkillTool,
    {
      name: 'skill__auto-skill__auto_tool',
      description: '',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'skill__manual-skill__manual_tool',
      description: '',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'skill__agent-skill__agent_tool',
      description: '',
      input_schema: { type: 'object', properties: {} },
    },
  ];

  it('always includes non-skill tools', () => {
    const filtered = filterToolsByInvocationPolicy(allTools);
    expect(filtered.some((t) => t.name === 'read_file')).toBe(true);
  });

  it('always includes auto-policy skills', () => {
    const filtered = filterToolsByInvocationPolicy(allTools);
    expect(filtered.some((t) => t.name === 'skill__auto-skill__auto_tool')).toBe(true);
  });

  it('excludes manual-policy skills when not requested', () => {
    const filtered = filterToolsByInvocationPolicy(allTools);
    expect(filtered.some((t) => t.name === 'skill__manual-skill__manual_tool')).toBe(false);
  });

  it('includes manual-policy skills when requested by name', () => {
    const filtered = filterToolsByInvocationPolicy(allTools, ['Manual Skill']);
    expect(filtered.some((t) => t.name === 'skill__manual-skill__manual_tool')).toBe(true);
  });

  it('includes manual-policy skills when requested by id', () => {
    const filtered = filterToolsByInvocationPolicy(allTools, ['manual-skill']);
    expect(filtered.some((t) => t.name === 'skill__manual-skill__manual_tool')).toBe(true);
  });

  it('always includes agent-decides-policy skills', () => {
    const filtered = filterToolsByInvocationPolicy(allTools);
    expect(filtered.some((t) => t.name === 'skill__agent-skill__agent_tool')).toBe(true);
  });

  it('includes tools for unregistered skills', () => {
    const orphanTool: ToolDefinition = {
      name: 'skill__unknown__do_thing',
      description: '',
      input_schema: { type: 'object', properties: {} },
    };
    const filtered = filterToolsByInvocationPolicy([orphanTool]);
    expect(filtered).toHaveLength(1);
  });
});
