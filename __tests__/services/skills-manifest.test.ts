import {
  buildSkillMetadataFromFrontmatter,
  getSkillCompatibility,
  getSkillRequiredSecrets,
} from '../../src/services/skills/manifest';

describe('skills manifest', () => {
  it('preserves Kavi manifest fields used for skill setup', () => {
    const metadata = buildSkillMetadataFromFrontmatter({
      name: 'GitHub Skill',
      description: 'Manage repositories and issues',
      version: '1.0.0',
      tools: ['repos', 'issues'],
      metadata: {
        kavi: {
          skillKey: 'github',
          primaryEnv: 'GITHUB_TOKEN',
          always: true,
          preferredSurface: 'mcp',
          surfaces: ['mcp', 'browser-job'],
          requires: {
            env: ['GITHUB_TOKEN'],
          },
        },
      },
    });

    expect(metadata).toEqual(
      expect.objectContaining({
        skillKey: 'github',
        always: true,
        primaryEnv: 'GITHUB_TOKEN',
        preferredSurface: 'mcp',
        surfaces: ['mcp', 'browser-job'],
        requiredSecrets: ['GITHUB_TOKEN'],
        tools: ['repos', 'issues'],
      }),
    );
  });

  it('ignores non-Kavi manifest containers when resolving skill setup fields', () => {
    const privateMetadataKey = ['open', 'claw'].join('');
    const metadata = buildSkillMetadataFromFrontmatter({
      name: 'GitHub Skill',
      description: 'Manage repositories and issues',
      version: '1.0.0',
      tools: ['repos', 'issues'],
      metadata: {
        [privateMetadataKey]: {
          skillKey: 'github',
          primaryEnv: 'GITHUB_TOKEN',
          always: true,
          preferredSurface: 'mcp',
          surfaces: ['local-mobile', 'mcp', 'ssh'],
          requires: {
            env: ['GITHUB_TOKEN'],
            bins: ['gh'],
          },
        },
      },
    });

    expect(metadata).toEqual(
      expect.objectContaining({
        skillKey: 'github-skill',
        always: false,
        primaryEnv: undefined,
        preferredSurface: undefined,
        surfaces: undefined,
        requiredSecrets: [],
        tools: ['repos', 'issues'],
      }),
    );
  });

  it('routes binary-dependent skills to SSH and workspace when mobile surfaces are insufficient', () => {
    const compatibility = getSkillCompatibility({
      name: 'CLI GitHub Skill',
      description: 'Requires gh',
      version: '1.0.0',
      skillKey: 'github',
      requires: {
        bins: ['gh'],
      },
      install: [
        {
          id: 'brew-gh',
          kind: 'brew',
          label: 'Install gh',
          bins: ['gh'],
        },
      ],
    });

    expect(compatibility.compatible).toBe(false);
    expect(compatibility.status).toBe('requires-external-surface');
    expect(compatibility.preferredSurface).toBe('ssh');
    expect(compatibility.suggestedSurfaces).toEqual(['ssh', 'workspace']);
    expect(compatibility.reason).toContain('Requires local binaries: gh');
    expect(compatibility.reason).toContain('Best route: SSH, Workspace');
  });

  it('marks secret-backed mobile skills as setup-required while keeping them installable', () => {
    const compatibility = getSkillCompatibility({
      name: 'GitHub API Skill',
      description: 'Uses the GitHub API from mobile tools.',
      version: '1.0.0',
      skillKey: 'github',
      primaryEnv: 'GITHUB_TOKEN',
      requiredSecrets: ['GITHUB_TOKEN'],
    });

    expect(compatibility.compatible).toBe(true);
    expect(compatibility.status).toBe('setup-required');
    expect(compatibility.preferredSurface).toBe('local-mobile');
    expect(compatibility.suggestedSurfaces).toEqual(['local-mobile']);
    expect(compatibility.availableSurfaces).toEqual(['local-mobile']);
    expect(compatibility.requiredSecrets).toEqual(['GITHUB_TOKEN']);
    expect(compatibility.reason).toContain('Requires setup: GITHUB_TOKEN');
  });

  it('honors explicitly declared remote surfaces when they are available in the eligibility context', () => {
    const compatibility = getSkillCompatibility(
      {
        name: 'Browserbase Review Skill',
        description: 'Review a page through a hosted browser session.',
        version: '1.0.0',
        preferredSurface: 'browser-job',
        surfaces: ['browser-job'],
      },
      {
        availableSurfaces: ['local-mobile', 'browser-job'],
      },
    );

    expect(compatibility.compatible).toBe(true);
    expect(compatibility.status).toBe('ready');
    expect(compatibility.preferredSurface).toBe('browser-job');
    expect(compatibility.availableSurfaces).toEqual(['browser-job']);
    expect(compatibility.unavailableSurfaces).toEqual([]);
  });

  it('does not infer browser-job from English hint words without explicit surface metadata', () => {
    const compatibility = getSkillCompatibility({
      name: 'Browser Review Skill',
      description: 'Uses browser automation, screenshots, and Playwright.',
      version: '1.0.0',
    });

    expect(compatibility.suggestedSurfaces).toEqual(['local-mobile']);
    expect(compatibility.preferredSurface).toBe('local-mobile');
  });

  it('does not infer MCP from English hint words without explicit surface metadata', () => {
    const compatibility = getSkillCompatibility({
      name: 'Registry Skill',
      description: 'Acts like an MCP registry helper.',
      version: '1.0.0',
    });

    expect(compatibility.suggestedSurfaces).toEqual(['local-mobile']);
    expect(compatibility.preferredSurface).toBe('local-mobile');
  });

  it('requires workspace config-path coverage before treating a workspace-routed skill as ready', () => {
    const metadata = {
      name: 'Workspace Skill',
      description: 'Needs config files',
      version: '1.0.0',
      requires: {
        config: ['/Users/username/.config/mytool'],
      },
    };

    const missingConfig = getSkillCompatibility(metadata, {
      availableSurfaces: ['local-mobile', 'workspace'],
      supportsConfigPath: (configPath) => configPath.startsWith('/tmp'),
    });

    expect(missingConfig.compatible).toBe(false);
    expect(missingConfig.status).toBe('requires-external-surface');

    const coveredConfig = getSkillCompatibility(metadata, {
      availableSurfaces: ['local-mobile', 'workspace'],
      supportsConfigPath: (configPath) => configPath.startsWith('/Users/username/.config'),
    });

    expect(coveredConfig.compatible).toBe(true);
    expect(coveredConfig.status).toBe('ready');
    expect(coveredConfig.availableSurfaces).toEqual(['workspace']);
  });

  it('treats skills as ready when all required secrets are already available in context', () => {
    const compatibility = getSkillCompatibility(
      {
        name: 'GitHub API Skill',
        description: 'Uses the GitHub API from mobile tools.',
        version: '1.0.0',
        skillKey: 'github',
        primaryEnv: 'GITHUB_TOKEN',
        requiredSecrets: ['GITHUB_TOKEN'],
      },
      {
        availableSurfaces: ['local-mobile'],
        hasSecret: (secretName) => secretName === 'GITHUB_TOKEN',
      },
    );

    expect(compatibility.compatible).toBe(true);
    expect(compatibility.status).toBe('ready');
    expect(compatibility.requiredSecrets).toEqual([]);
  });

  it('collects required secrets from primaryEnv and requires.env', () => {
    expect(
      getSkillRequiredSecrets({
        primaryEnv: 'GITHUB_TOKEN',
        requiredSecrets: ['FIRECRAWL_API_KEY'],
        requires: {
          env: ['GITHUB_TOKEN', 'BRAVE_API_KEY'],
        },
      }),
    ).toEqual(['FIRECRAWL_API_KEY', 'GITHUB_TOKEN', 'BRAVE_API_KEY']);
  });

  it('keeps Python-bin skills on external surfaces without explicit mobile metadata', () => {
    const metadata = {
      name: 'Weather API Skill',
      description: 'Fetches weather data using Python requests',
      version: '1.0.0',
      requires: {
        bins: ['python'],
      },
    };

    const result = getSkillCompatibility(metadata);

    expect(result.suggestedSurfaces).toEqual(['ssh', 'workspace']);
    expect(result.preferredSurface).toBe('ssh');
  });

  it('does not treat python-bin skills as local-mobile without explicit bundled metadata', () => {
    const metadata = {
      name: 'Async HTTP Python Skill',
      description: 'Fetches data with the built-in async bridge.',
      version: '1.0.0',
      requires: {
        bins: ['python'],
      },
    };

    const result = getSkillCompatibility(metadata);
    expect(result.compatible).toBe(false);
    expect(result.suggestedSurfaces).toEqual(['ssh', 'workspace']);
    expect(result.preferredSurface).toBe('ssh');
  });

  it('treats bundled Python sidecars as locally executable when analysis marks them Pyodide-compatible', () => {
    const result = getSkillCompatibility({
      name: 'Bundled Python Skill',
      description: 'Uses a sidecar Python script',
      version: '1.0.0',
      requires: {
        bins: ['python'],
      },
      bundledPython: {
        scriptPaths: ['scripts/run.py'],
        dependencies: ['httpx'],
        pyodideCompatible: true,
      },
    });

    expect(result.compatible).toBe(true);
    expect(result.preferredSurface).toBe('local-mobile');
    expect(result.suggestedSurfaces).toContain('local-mobile');
  });

  it('keeps bundled Python sidecars on external surfaces when analysis marks them incompatible', () => {
    const result = getSkillCompatibility({
      name: 'Native Python Skill',
      description: 'Needs native Python features',
      version: '1.0.0',
      requires: {
        bins: ['python'],
      },
      bundledPython: {
        scriptPaths: ['scripts/run.py'],
        pyodideCompatible: false,
      },
    });

    expect(result.suggestedSurfaces).not.toContain('local-mobile');
    expect(result.suggestedSurfaces).toEqual(['ssh', 'workspace']);
  });
});
