import {
  activateEnabledSkills,
  activateSkill,
  deactivateSkill,
  getLoadedSkill,
  makeEntry,
  registerSkill,
  resetSkillsManagerTestState,
  useSettingsStore,
  useSkillsStore,
} from '../helpers/skillsManagerHarness';
import type { Skill, SkillEntry } from '../helpers/skillsManagerHarness';

beforeEach(resetSkillsManagerTestState);

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
    expect(skill.tools).toHaveLength(0);
    expect(getLoadedSkill('act-1')).toBeDefined();
  });

  it('creates handlers that delegate to promptExecutor', async () => {
    const executor = jest.fn().mockResolvedValue('result-text');
    const entry = makeEntry({ id: 'act-2' });
    const skill = activateSkill(entry, executor);

    expect(skill.tools).toHaveLength(0);
  });

  it('creates tools without handlers when no executor provided', () => {
    const entry = makeEntry({ id: 'act-3' });
    const skill = activateSkill(entry);
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
