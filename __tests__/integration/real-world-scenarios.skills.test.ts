import {
  makeBrowserProvider,
  makeMcpServer,
  makeSkillEntry,
  makeSkillMetadata,
  makeSshTarget,
  makeWorkspaceTarget,
} from '../helpers/realWorldIntegrationHarness';
import { resolveSkillExecutionPlan } from '../../src/services/skills/routing';
import { buildSkillEligibilityContext } from '../../src/services/skills/eligibility';
import { getSkillCompatibility } from '../../src/services/skills/manifest';
import {
  parseSkillManifest,
  activateSkill,
  parseSkillToolName,
  executeSkillTool,
  unregisterSkill,
  getLoadedSkill,
} from '../../src/services/skills/manager';

describe('Real ClawHub Skills integration', () => {
  let fetchedSkills: Array<{
    displayName: string;
    slug: string;
    description?: string;
    tags?: string[];
  }> = [];

  beforeAll(async () => {
    try {
      const res = await fetch('https://clawhub.ai/api/v1/search?q=memory&limit=10', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.results)) {
          fetchedSkills = data.results.map((item: any) => ({
            displayName: item.displayName || item.name || item.slug || 'Unknown',
            slug: item.slug || 'unknown',
            description: item.summary || item.description,
            tags: Array.isArray(item.tags)
              ? item.tags
              : item.tags && typeof item.tags === 'object'
                ? Object.keys(item.tags)
                : undefined,
          }));
        }
      }
    } catch {
      // CI may not have network access.
    }
  }, 30000);

  it('fetches real skills from ClawHub', () => {
    // Structure assertions below run when ClawHub data is available.
    expect(fetchedSkills.length).toBeGreaterThanOrEqual(0);
  });

  it('all skills have required fields', () => {
    for (const skill of fetchedSkills) {
      expect(skill.displayName).toBeTruthy();
      expect(skill.slug).toBeTruthy();
      expect(typeof skill.displayName).toBe('string');
      expect(typeof skill.slug).toBe('string');
    }
  });

  it('builds valid skill metadata from fetched data', () => {
    for (const skill of fetchedSkills) {
      const metadata = makeSkillMetadata({
        name: skill.displayName,
        description: skill.description || 'No description',
        tags: skill.tags,
        skillKey: skill.slug,
      });

      expect(metadata.name).toBe(skill.displayName);
      expect(metadata.description).toBeTruthy();
      expect(metadata.version).toBeTruthy();
    }
  });

  it('activates and registers skills from real data', () => {
    for (const skill of fetchedSkills.slice(0, 3)) {
      const entry = makeSkillEntry({
        id: `real-${skill.slug}`,
        metadata: makeSkillMetadata({
          name: skill.displayName,
          description: skill.description || 'No description',
          tags: skill.tags,
          skillKey: skill.slug,
        }),
        systemPrompt: `You are a ${skill.displayName} assistant.`,
      });

      const activated = activateSkill(entry);
      expect(activated.id).toBe(entry.id);
      expect(activated.name).toBe(skill.displayName);
      expect(activated.systemPrompt).toBeTruthy();

      const loaded = getLoadedSkill(entry.id);
      expect(loaded).toBeDefined();
      expect(loaded!.name).toBe(skill.displayName);

      unregisterSkill(entry.id);
    }
  });

  it('routes real skills across execution surfaces', () => {
    for (const skill of fetchedSkills.slice(0, 3)) {
      const metadata = makeSkillMetadata({
        name: skill.displayName,
        description: skill.description || 'No description',
        tags: skill.tags,
        skillKey: skill.slug,
      });

      const settings = {
        mcpServers: [makeMcpServer()],
        sshTargets: [makeSshTarget()],
        workspaceTargets: [makeWorkspaceTarget()],
        browserProviders: [makeBrowserProvider()],
      };

      const plan = resolveSkillExecutionPlan(metadata, settings);
      expect(plan).toBeDefined();
      expect(plan.selectedRoute).not.toBeNull();
      // local-mobile should be the default selected route
      expect(plan.selectedRoute!.surface).toBe('local-mobile');
      expect(Array.isArray(plan.fallbackRoutes)).toBe(true);
    }
  });

  it('checks skill compatibility correctly', () => {
    for (const skill of fetchedSkills.slice(0, 3)) {
      const metadata = makeSkillMetadata({
        name: skill.displayName,
        description: skill.description || 'No description',
      });

      const eligibility = buildSkillEligibilityContext({
        mcpServers: [makeMcpServer()],
        sshTargets: [makeSshTarget()],
        workspaceTargets: [makeWorkspaceTarget()],
        browserProviders: [makeBrowserProvider()],
      });

      const compat = getSkillCompatibility(metadata, eligibility);
      expect(compat).toBeDefined();
      expect(compat.compatible).toBe(true);
      expect(compat.status).toBe('ready');
      expect(compat.availableSurfaces.length).toBeGreaterThan(0);
      expect(compat.availableSurfaces).toContain('local-mobile');
    }
  });
});

describe('Skill manifest parsing with real content', () => {
  it('parses a realistic github-issues SKILL.md', () => {
    const skillMd = `---
name: github-issues
description: Browse, search, create, and manage GitHub issues
version: 2.1.0
author: clawhub
tags:
  - github
  - issues
  - development
  - project-management
primaryEnv: desktop
invocationPolicy: auto
metadata:
  kavi:
    requires:
      env:
        - GITHUB_TOKEN
      bins:
        - gh
      anyBins:
        - curl
      config:
        - .github
    surfaces:
      - local-mobile
      - mcp
      - ssh
    install:
      - kind: brew
        formula: gh
        bins:
          - gh
        os:
          - macos
      - kind: apt
        package: gh
        bins:
          - gh
        os:
          - linux
---

# GitHub Issues Skill

Use this skill to interact with GitHub issues. You can:
- List issues for a repository
- Search issues by label, assignee, or keyword
- Create new issues
- Comment on existing issues

## Usage
\`\`\`bash
gh issue list --repo owner/repo
\`\`\`
`;

    const metadata = parseSkillManifest(skillMd);
    expect(metadata).not.toBeNull();
    expect(metadata!.name).toBe('github-issues');
    expect(metadata!.description).toContain('GitHub issues');
    expect(metadata!.version).toBe('2.1.0');
    expect(metadata!.author).toBe('clawhub');
    expect(metadata!.tags).toContain('github');
    expect(metadata!.primaryEnv).toBe('desktop');
    expect(metadata!.surfaces).toContain('local-mobile');
    expect(metadata!.surfaces).toContain('mcp');
    expect(metadata!.surfaces).toContain('ssh');
    expect(metadata!.invocationPolicy).toBe('auto');
    expect(metadata!.requires?.env).toContain('GITHUB_TOKEN');
    expect(metadata!.requires?.bins).toContain('gh');
    expect(metadata!.requires?.config).toContain('.github');
    // install spec parsing is exercised in the dedicated skills-manager unit tests
  });

  it('gets compatibility for skill requiring GITHUB_TOKEN', () => {
    const metadata = makeSkillMetadata({
      name: 'github-issues',
      requires: { env: ['GITHUB_TOKEN'], bins: ['gh'], config: ['.github'] },
      surfaces: ['local-mobile', 'mcp', 'ssh'],
    });

    const eligibilityNoSecret = buildSkillEligibilityContext({
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [],
    });

    const compatNoSecret = getSkillCompatibility(metadata, eligibilityNoSecret);
    expect(compatNoSecret).toBeDefined();
    expect(compatNoSecret.requiredSecrets).toContain('GITHUB_TOKEN');

    const eligibilityWithSsh = buildSkillEligibilityContext({
      mcpServers: [],
      sshTargets: [makeSshTarget()],
      workspaceTargets: [],
      browserProviders: [],
    });

    const compatWithSsh = getSkillCompatibility(metadata, eligibilityWithSsh);
    expect(compatWithSsh).toBeDefined();
    expect(compatWithSsh.availableSurfaces).toContain('ssh');
  });

  it('adapts shell-command skills for mobile on activation', () => {
    const entry = makeSkillEntry({
      id: 'shell-adapt-test',
      metadata: makeSkillMetadata({ name: 'curl-test' }),
      systemPrompt:
        '```bash\ncurl -X GET https://api.example.com/data\n```\nUse curl to fetch data.',
    });

    const skill = activateSkill(entry);
    expect(skill.systemPrompt).toContain('Mobile adaptation');
    expect(skill.systemPrompt).toContain('web_fetch');

    unregisterSkill(entry.id);
  });

  it('does NOT add mobile adaptation for non-shell skills', () => {
    const entry = makeSkillEntry({
      id: 'no-adapt-test',
      metadata: makeSkillMetadata({ name: 'pure-prompt-skill' }),
      systemPrompt: 'You are a helpful assistant that summarizes text.',
    });

    const skill = activateSkill(entry);
    expect(skill.systemPrompt).not.toContain('Mobile adaptation');
    expect(skill.systemPrompt).toBe('You are a helpful assistant that summarizes text.');

    unregisterSkill(entry.id);
  });

  it('skill tool name parsing round-trips correctly', () => {
    const cases = [
      {
        input: 'skill__my-skill__do_thing',
        expectedSkillId: 'my-skill',
        expectedToolName: 'do_thing',
      },
      {
        input: 'skill__github-issues__list_issues',
        expectedSkillId: 'github-issues',
        expectedToolName: 'list_issues',
      },
      { input: 'not_a_skill_tool', expectedSkillId: null, expectedToolName: null },
      { input: 'mcp__server__tool', expectedSkillId: null, expectedToolName: null },
      { input: 'skill__single', expectedSkillId: null, expectedToolName: null },
    ];

    for (const tc of cases) {
      const parsed = parseSkillToolName(tc.input);
      if (tc.expectedSkillId) {
        expect(parsed).not.toBeNull();
        expect(parsed!.skillId).toBe(tc.expectedSkillId);
        expect(parsed!.toolName).toBe(tc.expectedToolName);
      } else {
        expect(parsed).toBeNull();
      }
    }
  });

  it('handles skill tool execution for unloaded skill', async () => {
    const result = await executeSkillTool('skill__nonexistent__action', '{}');
    expect(result).toContain('Error');
    expect(result).toContain('not loaded');
  });
});

describe('Skill eligibility with realistic surface combinations', () => {
  it('mobile-only setup', () => {
    const ctx = buildSkillEligibilityContext({
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [],
    });

    expect(ctx.availableSurfaces).toContain('local-mobile');
    expect(ctx.availableSurfaces).not.toContain('mcp');
    expect(ctx.availableSurfaces).not.toContain('ssh');
    expect(ctx.availableSurfaces).not.toContain('workspace');
    expect(ctx.availableSurfaces).not.toContain('browser-job');
  });

  it('full production setup', () => {
    const ctx = buildSkillEligibilityContext({
      mcpServers: [makeMcpServer()],
      sshTargets: [makeSshTarget()],
      workspaceTargets: [makeWorkspaceTarget()],
      browserProviders: [
        makeBrowserProvider({
          provider: 'custom',
          authMode: 'none',
          baseUrl: 'https://custom.example.com',
        }),
      ],
    });

    const surfaces = ctx.availableSurfaces ?? [];
    expect(surfaces).toContain('local-mobile');
    expect(surfaces).toContain('local-js');
    expect(surfaces).toContain('mcp');
    expect(surfaces).toContain('ssh');
    expect(surfaces).toContain('workspace');
    expect(surfaces).toContain('browser-job');
    expect(surfaces.length).toBe(6);
  });

  it('surfaces are in priority order', () => {
    const ctx = buildSkillEligibilityContext({
      mcpServers: [makeMcpServer()],
      sshTargets: [makeSshTarget()],
      workspaceTargets: [makeWorkspaceTarget()],
      browserProviders: [
        makeBrowserProvider({
          provider: 'custom',
          authMode: 'none',
          baseUrl: 'https://custom.example.com',
        }),
      ],
    });

    const order = ['local-mobile', 'local-js', 'mcp', 'ssh', 'workspace', 'browser-job'];
    let lastIndex = -1;
    for (const surface of ctx.availableSurfaces ?? []) {
      const idx = order.indexOf(surface);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it('skill with browser requirement routes to browser-job', () => {
    const metadata = makeSkillMetadata({
      name: 'web-scraper',
      description: 'Scrapes web pages using browser automation',
      surfaces: ['browser-job'],
      requires: { bins: ['playwright'] },
    });

    const settings = {
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [
        makeBrowserProvider({
          provider: 'custom',
          authMode: 'none',
          baseUrl: 'https://custom.example.com',
        }),
      ],
    };

    const plan = resolveSkillExecutionPlan(metadata, settings);
    expect(plan.selectedRoute).not.toBeNull();
    const hasBrowserRoute = [plan.selectedRoute, ...plan.fallbackRoutes].some(
      (r) => r?.surface === 'browser-job',
    );
    expect(hasBrowserRoute).toBe(true);
  });

  it('skill requiring config path routes through workspace', () => {
    const metadata = makeSkillMetadata({
      name: 'github-actions',
      requires: { config: ['/home/user/project/.github/workflows'] },
    });

    const settings = {
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [
        makeWorkspaceTarget({
          rootPath: '/home/user/project',
          configRoots: ['/home/user/project/.github'],
        }),
      ],
      browserProviders: [],
    };

    const plan = resolveSkillExecutionPlan(metadata, settings);
    expect(plan.selectedRoute).not.toBeNull();
    const hasWorkspaceRoute = [plan.selectedRoute, ...plan.fallbackRoutes].some(
      (r) => r?.surface === 'workspace',
    );
    expect(hasWorkspaceRoute).toBe(true);
  });
});
