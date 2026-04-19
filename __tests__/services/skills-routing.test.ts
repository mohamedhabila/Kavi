import { buildSkillEligibilityContext } from '../../src/services/skills/eligibility';
import { resolveSkillExecutionPlan } from '../../src/services/skills/routing';

jest.mock('../../src/services/ssh/connector', () => ({
  getSshTargetReadiness: (target: any) => ({
    launchable: Boolean(target?.enabled && target?.host && target?.username),
    reason: target?.enabled ? 'ready' : 'disabled',
  }),
  getSshTargetLabel: (target: any) => `${target?.host || 'unknown'}:${target?.port || 22}`,
}));

describe('skills routing', () => {
  const settings = {
    mcpServers: [
      {
        id: 'mcp-1',
        name: 'Hosted MCP',
        url: 'https://mcp.example.com',
        enabled: true,
        tools: [],
        allowedTools: [],
      },
    ],
    sshTargets: [
      {
        id: 'ssh-1',
        name: 'Build box',
        host: 'ssh.example.com',
        port: 22,
        username: 'developer',
        authMode: 'password',
        passwordRef: 'ssh_password_1',
        enabled: true,
      },
    ],
    workspaceTargets: [
      {
        id: 'ws-1',
        name: 'Main repo',
        rootPath: '/Users/username/project',
        configRoots: ['/Users/username/.config'],
        provider: 'code-server',
        baseUrl: 'https://code.example.com',
        enabled: true,
      },
    ],
    browserProviders: [
      {
        id: 'browser-1',
        name: 'Primary Browserbase',
        provider: 'browserbase',
        baseUrl: 'https://api.browserbase.com',
        authMode: 'api-key-header',
        apiKeyRef: 'browser_provider_api_key_browser-1',
        projectId: 'proj_123',
        enabled: true,
      },
    ],
  };

  it('adds browser-job to the eligibility context when a browser provider is launchable', () => {
    const context = buildSkillEligibilityContext(settings);
    expect(context.availableSurfaces).toContain('browser-job');
  });

  it('resolves browser-routed skills to a concrete configured browser provider', () => {
    const plan = resolveSkillExecutionPlan(
      {
        name: 'Review Page',
        description: 'Take a screenshot through Browserbase',
        version: '1.0.0',
        preferredSurface: 'browser-job',
        surfaces: ['browser-job'],
      },
      settings,
    );

    expect(plan.selectedRoute).toEqual({
      surface: 'browser-job',
      targetId: 'browser-1',
      targetName: 'Primary Browserbase',
      detail: 'Browserbase · proj_123',
    });
  });

  it('filters workspace routes by required config-path coverage', () => {
    const plan = resolveSkillExecutionPlan(
      {
        name: 'Config Skill',
        description: 'Needs ~/.config coverage',
        version: '1.0.0',
        requires: {
          config: ['/Users/username/.config/mytool'],
        },
      },
      settings,
    );

    expect(plan.selectedRoute).toEqual({
      surface: 'workspace',
      targetId: 'ws-1',
      targetName: 'Main repo',
      detail: 'code-server · /Users/username/project',
    });
  });
});
