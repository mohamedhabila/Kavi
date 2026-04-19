import { buildSkillEligibilityContext } from '../../src/services/skills/eligibility';

describe('skill eligibility', () => {
  it('always exposes local-js even without workspace targets', () => {
    const context = buildSkillEligibilityContext({
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [],
      expoAccounts: [],
      expoProjects: [],
    });

    expect(context.availableSurfaces).toContain('local-mobile');
    expect(context.availableSurfaces).toContain('local-js');
    expect(context.availableSurfaces).not.toContain('workspace');
  });
});
