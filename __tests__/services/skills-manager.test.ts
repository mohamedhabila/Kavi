// ---------------------------------------------------------------------------
// Tests — Skills Manager
// ---------------------------------------------------------------------------

import {
  useSkillsStore,
  parseSkillManifest,
  registerSkill,
  unregisterSkill,
  getLoadedSkill,
  getAllLoadedSkills,
  getSkillToolDefinitions,
  parseSkillToolName,
  executeSkillTool,
  activateSkill,
  deactivateSkill,
  activateEnabledSkills,
  getSkillSystemPrompts,
  isSkillCompatible,
  filterToolsByInvocationPolicy,
} from '../../src/services/skills/manager';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Skill, SkillEntry, SkillMetadata } from '../../src/services/skills/types';
import type { ToolDefinition } from '../../src/types/tool';

jest.mock('../../src/services/ssh/connector', () => ({
  getSshTargetReadiness: (target: any) => ({
    launchable: Boolean(target?.enabled && target?.host && target?.username),
    reason: target?.enabled ? 'ready' : 'disabled',
  }),
  getSshTargetLabel: (target: any) => `${target?.host || 'unknown'}:${target?.port || 22}`,
}));

jest.mock('expo-file-system', () => {
  const store: Record<string, string | Uint8Array> = {};
  const dirs = new Set<string>();

  const normalizeUri = (value: string): string => value.replace(/\/+$/, '');

  const joinUri = (...parts: string[]): string => {
    if (parts.length === 0) {
      return '';
    }

    let result = parts[0] || '';
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index] || '';
      result = `${normalizeUri(result)}/${part.replace(/^\/+/, '')}`;
    }
    return normalizeUri(result);
  };

  const ensureParents = (uri: string) => {
    const normalizedUri = normalizeUri(uri);
    const pieces = normalizedUri.split('/');
    for (let index = 3; index < pieces.length; index += 1) {
      const dirUri = pieces.slice(0, index).join('/');
      if (dirUri) {
        dirs.add(dirUri);
      }
    }
  };

  class MockFile {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          pathParts.push(part);
        } else if (part && typeof part.uri === 'string') {
          pathParts.push(part.uri);
        }
      }

      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }

    get exists() {
      return this.uri in store;
    }

    async text() {
      const value = store[this.uri];
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof Uint8Array) {
        return new TextDecoder().decode(value);
      }
      return '';
    }

    async bytes() {
      const value = store[this.uri];
      if (value instanceof Uint8Array) {
        return value;
      }
      if (typeof value === 'string') {
        return new TextEncoder().encode(value);
      }
      return new Uint8Array(0);
    }

    write(content: string | Uint8Array) {
      ensureParents(this.uri);
      store[this.uri] = content;
    }

    delete() {
      delete store[this.uri];
    }
  }

  class MockDirectory {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          pathParts.push(part);
        } else if (part && typeof part.uri === 'string') {
          pathParts.push(part.uri);
        }
      }

      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }

    get exists() {
      return dirs.has(this.uri);
    }

    create(_options?: { idempotent?: boolean; intermediates?: boolean }) {
      ensureParents(this.uri);
      dirs.add(this.uri);
    }

    list() {
      const prefix = `${this.uri}/`;
      const entries = new Map<string, MockFile | MockDirectory>();

      for (const dir of dirs) {
        if (!dir.startsWith(prefix)) {
          continue;
        }

        const rest = dir.slice(prefix.length);
        if (!rest || rest.includes('/')) {
          continue;
        }

        entries.set(rest, new MockDirectory(this, rest));
      }

      for (const fileUri of Object.keys(store)) {
        if (!fileUri.startsWith(prefix)) {
          continue;
        }

        const rest = fileUri.slice(prefix.length);
        if (!rest) {
          continue;
        }

        const firstPart = rest.split('/')[0];
        if (rest.includes('/')) {
          entries.set(firstPart, new MockDirectory(this, firstPart));
        } else {
          entries.set(firstPart, new MockFile(this, firstPart));
        }
      }

      return Array.from(entries.values());
    }

    delete() {
      dirs.delete(this.uri);
      for (const dir of Array.from(dirs)) {
        if (dir.startsWith(`${this.uri}/`)) {
          dirs.delete(dir);
        }
      }
      for (const fileUri of Object.keys(store)) {
        if (fileUri.startsWith(`${this.uri}/`)) {
          delete store[fileUri];
        }
      }
    }
  }

  const documentRoot = 'file:///mock/documents';
  dirs.add(documentRoot);

  return {
    File: MockFile,
    Directory: MockDirectory,
    documentDirectory: `${documentRoot}/`,
    Paths: {
      get document() {
        return new MockDirectory(documentRoot);
      },
    },
    makeDirectoryAsync: jest.fn(async (uri: string) => {
      const normalizedUri = normalizeUri(uri);
      dirs.add(normalizedUri);
      ensureParents(normalizedUri);
    }),
    writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
      const normalizedUri = normalizeUri(uri);
      ensureParents(normalizedUri);
      store[normalizedUri] = content;
    }),
    readAsStringAsync: jest.fn(async (uri: string) => store[normalizeUri(uri)] || ''),
    getInfoAsync: jest.fn(async (uri: string) => {
      const normalizedUri = normalizeUri(uri);
      return {
        exists: normalizedUri in store || dirs.has(normalizedUri),
        isDirectory: dirs.has(normalizedUri),
      };
    }),
    readDirectoryAsync: jest.fn(async (uri: string) => {
      const normalizedUri = normalizeUri(uri);
      return new MockDirectory(normalizedUri).list().map((entry) => entry.name);
    }),
    deleteAsync: jest.fn(async (uri: string) => {
      const normalizedUri = normalizeUri(uri);
      delete store[normalizedUri];
      new MockDirectory(normalizedUri).delete();
    }),
    __resetStore: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
      dirs.clear();
      dirs.add(documentRoot);
    },
    __getStore: () => store,
  };
});

const { __resetStore, __getStore } = require('expo-file-system');

beforeEach(() => {
  // Reset store
  useSkillsStore.setState({ entries: [] });
  useSettingsStore.setState({
    mcpServers: [],
    sshTargets: [],
    workspaceTargets: [],
  });
  // Unregister all loaded skills
  for (const s of getAllLoadedSkills()) {
    unregisterSkill(s.id);
  }
  __resetStore();
});

describe('useSkillsStore', () => {
  const entry: SkillEntry = {
    id: 'skill-1',
    name: 'Test Skill',
    description: 'A test skill',
    enabled: true,
    source: 'local',
    version: '1.0.0',
  };

  it('starts with empty entries', () => {
    expect(useSkillsStore.getState().entries).toEqual([]);
  });

  it('addEntry adds a skill entry', () => {
    useSkillsStore.getState().addEntry(entry);
    expect(useSkillsStore.getState().entries).toHaveLength(1);
    expect(useSkillsStore.getState().entries[0].name).toBe('Test Skill');
  });

  it('addEntry activates enabled runtime skills immediately', () => {
    const runtimeEntry = makeEntry({ id: 'store-add-1', systemPrompt: 'Use this skill.' });

    useSkillsStore.getState().addEntry(runtimeEntry);

    expect(getLoadedSkill('store-add-1')).toEqual(
      expect.objectContaining({
        id: 'store-add-1',
        systemPrompt: 'Use this skill.',
      }),
    );
  });

  it('removeEntry removes an entry by id', () => {
    useSkillsStore.getState().addEntry(entry);
    useSkillsStore.getState().removeEntry('skill-1');
    expect(useSkillsStore.getState().entries).toHaveLength(0);
  });

  it('toggleEntry toggles enabled state', () => {
    useSkillsStore.getState().addEntry(entry);
    expect(useSkillsStore.getState().entries[0].enabled).toBe(true);

    useSkillsStore.getState().toggleEntry('skill-1');
    expect(useSkillsStore.getState().entries[0].enabled).toBe(false);

    useSkillsStore.getState().toggleEntry('skill-1');
    expect(useSkillsStore.getState().entries[0].enabled).toBe(true);
  });

  it('toggleEntry syncs runtime registration', () => {
    const runtimeEntry = makeEntry({ id: 'toggle-1', systemPrompt: 'Toggle me.' });
    useSkillsStore.getState().addEntry(runtimeEntry);
    expect(getLoadedSkill('toggle-1')).toBeDefined();

    useSkillsStore.getState().toggleEntry('toggle-1');
    expect(getLoadedSkill('toggle-1')).toBeUndefined();

    useSkillsStore.getState().toggleEntry('toggle-1');
    expect(getLoadedSkill('toggle-1')).toBeDefined();
  });

  it('getEnabled returns only enabled entries', () => {
    useSkillsStore.getState().addEntry(entry);
    useSkillsStore.getState().addEntry({
      ...entry,
      id: 'skill-2',
      name: 'Disabled',
      enabled: false,
    });

    const enabled = useSkillsStore.getState().getEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe('Test Skill');
  });
});

describe('parseSkillManifest', () => {
  it('parses valid SKILL.md frontmatter', () => {
    const content = `---
name: My Skill
description: A cool skill
version: 2.0.0
author: Test Author
tags:
  - utility
  - test
invocationPolicy: manual
---

# My Skill

Instructions here.
`;
    const meta = parseSkillManifest(content);
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe('My Skill');
    expect(meta!.description).toBe('A cool skill');
    expect(meta!.version).toBe('2.0.0');
    expect(meta!.author).toBe('Test Author');
    expect(meta!.tags).toEqual(['utility', 'test']);
    expect(meta!.invocationPolicy).toBe('manual');
  });

  it('returns null if name is missing', () => {
    const content = `---
description: No name skill
---
Content`;
    expect(parseSkillManifest(content)).toBeNull();
  });

  it('uses defaults for optional fields', () => {
    const content = `---
name: Minimal
---`;
    const meta = parseSkillManifest(content);
    expect(meta!.description).toBe('');
    expect(meta!.version).toBe('1.0.0');
    expect(meta!.invocationPolicy).toBe('auto');
  });
});

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
          // no handler
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

// ── New extensibility tests ──────────────────────────────────────────────

// Helper: create a SkillEntry using the correct type structure
function makeEntry(overrides: Partial<SkillEntry> & { id: string }): SkillEntry {
  return {
    metadata: {
      name: 'Test Skill',
      description: 'A test skill',
      version: '1.0.0',
      author: 'tester',
      tags: [],
      invocationPolicy: 'auto',
      tools: ['do_thing'],
    },
    enabled: true,
    installedAt: Date.now(),
    source: {
      source: 'clawhub',
      id: 'hub-1',
      url: 'https://clawhub.ai/api/v1/skills/hub-1/file?path=SKILL.md',
      version: '1.0.0',
    },
    ...overrides,
  };
}

describe('useSkillsStore — updateEntry', () => {
  it('updates metadata on an existing entry', () => {
    const entry = makeEntry({ id: 'upd-1' });
    useSkillsStore.getState().addEntry(entry);

    useSkillsStore.getState().updateEntry('upd-1', {
      metadata: { ...entry.metadata, version: '2.0.0' },
    });

    const updated = useSkillsStore.getState().entries.find((e) => e.id === 'upd-1');
    expect(updated?.metadata.version).toBe('2.0.0');
  });

  it('does nothing for non-existent id', () => {
    useSkillsStore.getState().addEntry(makeEntry({ id: 'upd-2' }));
    useSkillsStore.getState().updateEntry('missing', { enabled: false });
    // No crash, entry unchanged
    expect(useSkillsStore.getState().entries[0].enabled).toBe(true);
  });

  it('refreshes runtime skill when enabled entry metadata changes', () => {
    const entry = makeEntry({ id: 'upd-runtime-1', systemPrompt: 'Original prompt.' });
    useSkillsStore.getState().addEntry(entry);

    useSkillsStore.getState().updateEntry('upd-runtime-1', {
      metadata: { ...entry.metadata, name: 'Updated Skill' },
      systemPrompt: 'Updated prompt.',
    });

    expect(getLoadedSkill('upd-runtime-1')).toEqual(
      expect.objectContaining({
        name: 'Updated Skill',
        systemPrompt: 'Updated prompt.',
      }),
    );
  });
});

describe('useSkillsStore — removeEntry runtime cleanup', () => {
  it('unregisters runtime skill when entry is removed', () => {
    const skill: Skill = {
      id: 'cleanup-1',
      name: 'Cleanup Skill',
      description: '',
      version: '1.0',
      tools: [],
    };
    registerSkill(skill);
    expect(getLoadedSkill('cleanup-1')).toBeDefined();

    // Add entry then remove — should also clean up runtime
    useSkillsStore.getState().addEntry(makeEntry({ id: 'cleanup-1' }));
    useSkillsStore.getState().removeEntry('cleanup-1');
    expect(getLoadedSkill('cleanup-1')).toBeUndefined();
  });
});

describe('activateSkill', () => {
  it('converts a SkillEntry to a runtime Skill with tools', () => {
    const entry = makeEntry({ id: 'act-1' });
    const skill = activateSkill(entry);

    expect(skill.id).toBe('act-1');
    expect(skill.name).toBe('Test Skill');
    // Skills are now prompt-based; tools array is always empty
    expect(skill.tools).toHaveLength(0);
    expect(getLoadedSkill('act-1')).toBeDefined();
  });

  it('creates handlers that delegate to promptExecutor', async () => {
    const executor = jest.fn().mockResolvedValue('result-text');
    const entry = makeEntry({ id: 'act-2' });
    const skill = activateSkill(entry, executor);

    // promptExecutor is no longer used — skills are prompt-based
    expect(skill.tools).toHaveLength(0);
  });

  it('creates tools without handlers when no executor provided', () => {
    const entry = makeEntry({ id: 'act-3' });
    const skill = activateSkill(entry);
    // Skills are prompt-based; no tools are created
    expect(skill.tools).toHaveLength(0);
  });

  it('preserves systemPrompt and invocationPolicy on the Skill', () => {
    const entry = makeEntry({
      id: 'act-4',
      systemPrompt: 'Use this skill carefully.',
      metadata: {
        name: 'PolicySkill',
        description: '',
        version: '1.0',
        invocationPolicy: 'manual',
        tools: [],
      },
    });
    const skill = activateSkill(entry);
    expect(skill.systemPrompt).toBe('Use this skill carefully.');
    expect(skill.invocationPolicy).toBe('manual');
  });
});

describe('deactivateSkill', () => {
  it('removes the skill from runtime registry', () => {
    const entry = makeEntry({ id: 'deact-1' });
    activateSkill(entry);
    expect(getLoadedSkill('deact-1')).toBeDefined();

    deactivateSkill('deact-1');
    expect(getLoadedSkill('deact-1')).toBeUndefined();
  });
});

describe('activateEnabledSkills', () => {
  it('activates all enabled entries from the store', () => {
    useSkillsStore.getState().addEntry(makeEntry({ id: 'en-1', enabled: true }));
    useSkillsStore.getState().addEntry(makeEntry({ id: 'en-2', enabled: false }));
    useSkillsStore.getState().addEntry(makeEntry({ id: 'en-3', enabled: true }));

    const skills = activateEnabledSkills();
    expect(skills).toHaveLength(2);
    expect(getLoadedSkill('en-1')).toBeDefined();
    expect(getLoadedSkill('en-2')).toBeUndefined();
    expect(getLoadedSkill('en-3')).toBeDefined();
  });

  it('passes promptExecutor to each activation', async () => {
    const executor = jest.fn().mockResolvedValue('ok');
    useSkillsStore.getState().addEntry(makeEntry({ id: 'exe-1', enabled: true }));

    const skills = activateEnabledSkills(executor);
    // Skills are prompt-based; no tools created regardless of executor
    expect(skills[0].tools).toHaveLength(0);
  });

  it('activates remote-execution skills when an SSH target is configured', () => {
    useSettingsStore.setState({
      sshTargets: [
        {
          id: 'ssh-1',
          name: 'Build box',
          host: 'ssh.example.com',
          port: 22,
          username: 'developer',
          authMode: 'password',
          passwordRef: 'ssh_password_ssh-1',
          enabled: true,
        },
      ],
    });
    useSkillsStore.getState().addEntry(
      makeEntry({
        id: 'ssh-skill',
        metadata: {
          name: 'CLI Skill',
          description: 'Uses gh',
          version: '1.0.0',
          requires: { bins: ['gh'] },
        },
      }),
    );

    const skills = activateEnabledSkills();
    expect(skills).toHaveLength(1);
    expect(getLoadedSkill('ssh-skill')).toBeDefined();
  });
});

describe('getSkillSystemPrompts', () => {
  it('returns an empty string when no skills are loaded', async () => {
    await expect(getSkillSystemPrompts('conv-1')).resolves.toBe('');
  });

  it('returns a minimal skill catalog and materializes the skill file', async () => {
    useSkillsStore.getState().addEntry(
      makeEntry({
        id: 'sp-1',
        systemPrompt: '# Prompt Skill\n\nAlways be helpful.',
        metadata: {
          name: 'Prompt Skill',
          description: 'Useful for prompt work.',
          version: '1.0',
          tools: [],
        },
        source: {
          source: 'clawhub',
          id: 'sp-1',
          url: 'https://clawhub.ai/api/v1/skills/sp-1/file?path=SKILL.md',
        },
      }),
    );
    useSkillsStore.getState().addEntry(
      makeEntry({
        id: 'sp-2',
        metadata: {
          name: 'No Prompt',
          description: '',
          version: '1.0',
          tools: [],
        },
        source: {
          source: 'clawhub',
          id: 'sp-2',
          url: 'https://clawhub.ai/api/v1/skills/sp-2/file?path=SKILL.md',
        },
      }),
    );

    const prompt = await getSkillSystemPrompts('conv-1');
    expect(prompt).toContain('Available skills:');
    expect(prompt).toContain('- Prompt Skill: skills/prompt-skill-sp-1/SKILL.md');
    expect(prompt).not.toContain('Always be helpful.');
    expect(
      __getStore()['file:///mock/documents/workspace/conv-1/skills/prompt-skill-sp-1/SKILL.md'],
    ).toContain('Always be helpful.');
  });

  it('keeps bundled Python skills minimal in the prompt while materializing scripts', async () => {
    __getStore()['file:///mock/documents/.managed-skills/ontology-skill-ontology/SKILL.md'] =
      '# Ontology\n\nUse scripts/ontology.py';
    __getStore()[
      'file:///mock/documents/.managed-skills/ontology-skill-ontology/scripts/ontology.py'
    ] = 'print("ok")\n';

    useSkillsStore.getState().addEntry(
      makeEntry({
        id: 'ontology',
        systemPrompt: '# Ontology\n\nUse scripts/ontology.py',
        metadata: {
          name: 'Ontology Skill',
          description: 'Structured local graph operations.',
          version: '1.0',
          bundledPython: {
            scriptPaths: ['scripts/ontology.py'],
            dependencies: ['pyyaml'],
            pyodideCompatible: true,
          },
        },
        source: {
          source: 'clawhub',
          id: 'ontology',
          version: '1.0',
          url: 'https://clawhub.ai/api/v1/skills/ontology/file?path=SKILL.md',
          managedDir: 'ontology-skill-ontology',
          managedFiles: ['SKILL.md', 'scripts/ontology.py'],
        },
      }),
    );

    const prompt = await getSkillSystemPrompts('conv-ontology');
    expect(prompt).toContain('- Ontology Skill: skills/ontology-skill-ontology/SKILL.md');
    expect(prompt).not.toContain('scripts/ontology.py');
    expect(
      __getStore()[
        'file:///mock/documents/workspace/conv-ontology/skills/ontology-skill-ontology/scripts/ontology.py'
      ],
    ).toBe('print("ok")\n');
  });

  it('materializes binary skill assets into the workspace alongside text files', async () => {
    const iconBytes = new Uint8Array([1, 2, 3, 4]);
    __getStore()['file:///mock/documents/.managed-skills/image-skill-image/SKILL.md'] =
      '# Image Skill\n';
    __getStore()['file:///mock/documents/.managed-skills/image-skill-image/assets/icon.png'] =
      iconBytes;

    useSkillsStore.getState().addEntry(
      makeEntry({
        id: 'image',
        metadata: {
          name: 'Image Skill',
          description: 'Needs a bundled icon.',
          version: '1.0',
        },
        source: {
          source: 'clawhub',
          id: 'image',
          version: '1.0',
          url: 'https://clawhub.ai/api/v1/skills/image/file?path=SKILL.md',
          managedDir: 'image-skill-image',
          managedFiles: ['SKILL.md', 'assets/icon.png'],
          managedBinaryFiles: ['assets/icon.png'],
        },
      }),
    );

    await getSkillSystemPrompts('conv-binary');

    expect(
      __getStore()[
        'file:///mock/documents/workspace/conv-binary/skills/image-skill-image/assets/icon.png'
      ],
    ).toEqual(iconBytes);
  });

  it('omits manual skills from the prompt catalog', async () => {
    useSkillsStore.getState().addEntry(
      makeEntry({
        id: 'manual-skill',
        systemPrompt: 'Use me only on request.',
        metadata: {
          name: 'Manual Skill',
          description: 'Manual only',
          version: '1.0',
          tools: [],
          invocationPolicy: 'manual',
        },
        source: {
          source: 'clawhub',
          id: 'manual-skill',
          url: 'https://clawhub.ai/api/v1/skills/manual-skill/file?path=SKILL.md',
        },
      }),
    );

    await expect(getSkillSystemPrompts('conv-1')).resolves.toBe('');
  });

  it('omits remote-only skills from the prompt catalog until a backing surface is configured', async () => {
    useSkillsStore.getState().addEntry(
      makeEntry({
        id: 'cli-skill',
        metadata: {
          name: 'CLI Skill',
          description: 'Needs gh',
          version: '1.0',
          requires: { bins: ['gh'] },
        },
      }),
    );

    await expect(getSkillSystemPrompts('conv-1')).resolves.toBe('');

    useSettingsStore.setState({
      sshTargets: [
        {
          id: 'ssh-1',
          name: 'Build box',
          host: 'ssh.example.com',
          port: 22,
          username: 'developer',
          authMode: 'password',
          passwordRef: 'ssh_password_ssh-1',
          enabled: true,
        },
      ],
    });

    await expect(getSkillSystemPrompts('conv-1')).resolves.toMatch(
      /- CLI Skill: skills\/.+\/SKILL\.md/,
    );
  });

  it('makes config-path skills visible only when a workspace target covers the required paths', async () => {
    useSkillsStore.getState().addEntry(
      makeEntry({
        id: 'workspace-skill',
        metadata: {
          name: 'Workspace Skill',
          description: 'Needs config files',
          version: '1.0',
          requires: { config: ['/Users/username/.config/mytool'] },
        },
      }),
    );

    useSettingsStore.setState({
      workspaceTargets: [
        {
          id: 'workspace-1',
          name: 'Main repo',
          rootPath: '/Users/username/project',
          provider: 'code-server',
          baseUrl: 'https://code.example.com',
          configRoots: ['/Users/username/.cache'],
          enabled: true,
        },
      ],
    });

    await expect(getSkillSystemPrompts('conv-1')).resolves.toBe('');

    useSettingsStore.setState({
      workspaceTargets: [
        {
          id: 'workspace-1',
          name: 'Main repo',
          rootPath: '/Users/username/project',
          provider: 'code-server',
          baseUrl: 'https://code.example.com',
          configRoots: ['/Users/username/.config'],
          enabled: true,
        },
      ],
    });

    await expect(getSkillSystemPrompts('conv-1')).resolves.toMatch(
      /- Workspace Skill: skills\/.+\/SKILL\.md/,
    );
  });

  it('truncates the stable catalog when the full prompt would exceed the budget', async () => {
    for (let index = 0; index < 160; index += 1) {
      useSkillsStore.getState().addEntry(
        makeEntry({
          id: `compact-${index}`,
          systemPrompt: `# Compact Skill ${index}\n\nUse this skill when asked.`,
          metadata: {
            name: `Compact Skill ${index}`,
            description: 'A'.repeat(400),
            version: '1.0',
            tools: [],
          },
          source: {
            source: 'clawhub',
            id: `compact-${index}`,
            url: `https://clawhub.ai/api/v1/skills/compact-${index}/file?path=SKILL.md`,
          },
        }),
      );
    }

    const prompt = await getSkillSystemPrompts('conv-compact');
    expect(prompt).toContain('Available skills:');
    expect(prompt).toMatch(/- Compact Skill 0: skills\/.+\/SKILL\.md/);
    expect(prompt).not.toContain('Compact Skill 159');
  });
});

describe('isSkillCompatible', () => {
  it('returns compatible for a standard skill', () => {
    const meta: SkillMetadata = {
      name: 'Normal',
      description: '',
      version: '1.0',
      tags: ['utility'],
    };
    const result = isSkillCompatible(meta);
    expect(result.compatible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns incompatible for desktop-only skills', () => {
    const meta: SkillMetadata = {
      name: 'Desktop',
      description: '',
      version: '1.0',
      tags: ['desktop-only'],
    };
    const result = isSkillCompatible(meta);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('desktop');
  });

  it('returns compatible with reason for skills needing secrets', () => {
    const meta: SkillMetadata = {
      name: 'Secret',
      description: '',
      version: '1.0',
      tags: [],
      requiredSecrets: ['API_KEY'],
    };
    const result = isSkillCompatible(meta);
    expect(result.compatible).toBe(true);
    expect(result.reason).toContain('API_KEY');
  });

  it('handles missing tags gracefully', () => {
    const meta: SkillMetadata = {
      name: 'NoTags',
      description: '',
      version: '1.0',
    };
    const result = isSkillCompatible(meta);
    expect(result.compatible).toBe(true);
  });
});

describe('filterToolsByInvocationPolicy', () => {
  const nonSkillTool: ToolDefinition = {
    name: 'read_file',
    description: 'Read a file',
    input_schema: { type: 'object', properties: {} },
  };

  beforeEach(() => {
    // Register skills with different policies
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
