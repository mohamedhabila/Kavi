import {
  getMockFileSystemStore,
  getSkillSystemPrompts,
  makeEntry,
  resetSkillsManagerTestState,
  useSettingsStore,
  useSkillsStore,
} from '../helpers/skillsManagerHarness';

beforeEach(resetSkillsManagerTestState);

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
      getMockFileSystemStore()['file:///mock/documents/workspace/conv-1/skills/prompt-skill-sp-1/SKILL.md'],
    ).toContain('Always be helpful.');
  });

  it('keeps bundled Python skills minimal in the prompt while materializing scripts', async () => {
    getMockFileSystemStore()['file:///mock/documents/.managed-skills/ontology-skill-ontology/SKILL.md'] =
      '# Ontology\n\nUse scripts/ontology.py';
    getMockFileSystemStore()[
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
      getMockFileSystemStore()[
        'file:///mock/documents/workspace/conv-ontology/skills/ontology-skill-ontology/scripts/ontology.py'
      ],
    ).toBe('print("ok")\n');
  });

  it('materializes binary skill assets into the workspace alongside text files', async () => {
    const iconBytes = new Uint8Array([1, 2, 3, 4]);
    getMockFileSystemStore()['file:///mock/documents/.managed-skills/image-skill-image/SKILL.md'] =
      '# Image Skill\n';
    getMockFileSystemStore()['file:///mock/documents/.managed-skills/image-skill-image/assets/icon.png'] =
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
      getMockFileSystemStore()[
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
