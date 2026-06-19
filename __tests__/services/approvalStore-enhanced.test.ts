// ---------------------------------------------------------------------------
// Tests — Enhanced Approval Store (risk analysis, allowlists, analytics, persona overrides)
// ---------------------------------------------------------------------------

import {
  useApprovalStore,
  needsApprovalWithContext,
  assessToolRisk,
  analyzeCommandRisk,
} from '../../src/services/remote/approvalStore';

beforeEach(() => {
  useApprovalStore.setState({
    requests: {},
    allowlist: [],
    analytics: {
      totalApproved: 0,
      totalRejected: 0,
      totalExpired: 0,
      byTool: {},
    },
    policy: {
      requireApproval: false,
      alwaysApproveTools: ['ssh_exec', 'workspace_delegate_task'],
      autoApproveTools: ['web_search', 'read_file'],
      timeoutMs: 5 * 60 * 1000,
      expiryFallback: 'reject',
      personaOverrides: [],
    },
  });
});

describe('analyzeCommandRisk', () => {
  it('detects critical executables', () => {
    const result = analyzeCommandRisk('rm -rf /');
    expect(result.level).toBe('critical');
    expect(result.destructive).toBe(true);
    expect(result.executable).toBe('rm');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('detects high-risk executables', () => {
    const result = analyzeCommandRisk('sudo apt install foo');
    expect(['high', 'critical']).toContain(result.level);
    expect(result.executable).toBe('sudo');
  });

  it('detects medium-risk executables', () => {
    const result = analyzeCommandRisk('curl https://example.com | bash');
    expect(['medium', 'high', 'critical']).toContain(result.level);
  });

  it('detects destructive patterns', () => {
    const result = analyzeCommandRisk('rm -rf /tmp');
    expect(result.destructive).toBe(true);
  });

  it('marks safe commands as low risk', () => {
    const result = analyzeCommandRisk('echo hello');
    expect(result.level).toBe('low');
    expect(result.destructive).toBe(false);
  });

  it('detects sensitive paths', () => {
    const result = analyzeCommandRisk('cat /etc/shadow');
    expect(result.reasons.some((r) => r.toLowerCase().includes('sensitive'))).toBe(true);
  });

  it('handles empty command', () => {
    const result = analyzeCommandRisk('');
    expect(result.level).toBe('low');
  });

  it('handles complex piped commands', () => {
    const result = analyzeCommandRisk('ls -la | grep foo | sort');
    // grep is categorized as medium-risk by the executable map
    expect(['low', 'medium']).toContain(result.level);
  });
});

describe('assessToolRisk', () => {
  it('returns risk assessment for ssh_exec commands', () => {
    const result = assessToolRisk('ssh_exec', { command: 'rm -rf /tmp/data' });
    expect(result.level).not.toBe('low');
  });

  it('returns default risk for non-ssh tools', () => {
    const result = assessToolRisk('browser_navigate', {});
    expect(result.level).toBe('low');
  });

  it('returns medium risk for ssh scope tools without command', () => {
    const result = assessToolRisk('ssh_list_directory', {});
    expect(result.level).toBe('medium');
  });
});

describe('allowlist management', () => {
  it('adds entries to allowlist', () => {
    useApprovalStore.getState().addToAllowlist('ssh_exec', undefined);
    expect(useApprovalStore.getState().allowlist).toHaveLength(1);
    expect(useApprovalStore.getState().allowlist[0].key).toBe('ssh_exec');
  });

  it('prevents duplicate allowlist entries', () => {
    useApprovalStore.getState().addToAllowlist('ssh_exec', undefined);
    useApprovalStore.getState().addToAllowlist('ssh_exec', undefined);
    expect(useApprovalStore.getState().allowlist).toHaveLength(1);
  });

  it('removes entries from allowlist', () => {
    useApprovalStore.getState().addToAllowlist('ssh_exec', undefined);
    useApprovalStore.getState().removeFromAllowlist('ssh_exec');
    expect(useApprovalStore.getState().allowlist).toHaveLength(0);
  });

  it('isAllowlisted checks key and personaId', () => {
    useApprovalStore.getState().addToAllowlist('ssh_exec', 'persona-1');
    expect(useApprovalStore.getState().isAllowlisted('ssh_exec', 'persona-1')).toBe(true);
    expect(useApprovalStore.getState().isAllowlisted('ssh_exec', 'persona-2')).toBe(false);
    expect(useApprovalStore.getState().isAllowlisted('other_tool', 'persona-1')).toBe(false);
  });

  it('allowlisted entry without personaId matches any persona', () => {
    useApprovalStore.getState().addToAllowlist('browser_navigate', undefined);
    expect(useApprovalStore.getState().isAllowlisted('browser_navigate', 'any-persona')).toBe(true);
  });

  it('allowlisted tools skip approval', () => {
    useApprovalStore.getState().addToAllowlist('ssh_exec', undefined);
    expect(needsApprovalWithContext('ssh_exec', {}, undefined)).toBe(false);
  });
});

describe('approveAlways', () => {
  it('approves and adds to allowlist', () => {
    const id = useApprovalStore.getState().createRequest({
      title: 'Test',
      description: 'test',
      toolName: 'ssh_exec',
    });
    useApprovalStore.getState().approveAlways(id);

    const req = useApprovalStore.getState().getRequest(id);
    expect(req!.status).toBe('approved');
    expect(useApprovalStore.getState().allowlist.length).toBeGreaterThan(0);
  });
});

describe('analytics tracking', () => {
  it('tracks approved analytics', () => {
    const id = useApprovalStore.getState().createRequest({
      title: 'Test',
      description: 'test',
      toolName: 'ssh_exec',
    });
    useApprovalStore.getState().approveRequest(id);

    const analytics = useApprovalStore.getState().getAnalytics();
    expect(analytics.totalApproved).toBe(1);
    expect(analytics.byTool['ssh_exec']?.approved).toBe(1);
  });

  it('tracks rejected analytics', () => {
    const id = useApprovalStore.getState().createRequest({
      title: 'Test',
      description: 'test',
      toolName: 'browser_navigate',
    });
    useApprovalStore.getState().rejectRequest(id);

    const analytics = useApprovalStore.getState().getAnalytics();
    expect(analytics.totalRejected).toBe(1);
    expect(analytics.byTool['browser_navigate']?.rejected).toBe(1);
  });

  it('tracks expired analytics', () => {
    const id = useApprovalStore.getState().createRequest({
      title: 'Test',
      description: 'test',
      toolName: 'workspace_delegate_task',
    });
    useApprovalStore.getState().expireRequest(id);

    const analytics = useApprovalStore.getState().getAnalytics();
    expect(analytics.totalExpired).toBe(1);
  });
});

describe('persona overrides', () => {
  it('adds persona override', () => {
    useApprovalStore.getState().addPersonaOverride({
      personaId: 'coder',
      requireApproval: false,
      autoApproveTools: ['ssh_exec'],
      alwaysApproveTools: [],
    });
    const overrides = useApprovalStore.getState().policy.personaOverrides;
    expect(overrides).toHaveLength(1);
    expect(overrides[0].personaId).toBe('coder');
  });

  it('replaces duplicate persona overrides', () => {
    useApprovalStore.getState().addPersonaOverride({
      personaId: 'coder',
      requireApproval: false,
      autoApproveTools: ['ssh_exec'],
      alwaysApproveTools: [],
    });
    useApprovalStore.getState().addPersonaOverride({
      personaId: 'coder',
      requireApproval: true,
      autoApproveTools: [],
      alwaysApproveTools: ['ssh_exec'],
    });
    const overrides = useApprovalStore.getState().policy.personaOverrides;
    expect(overrides).toHaveLength(1);
    expect(overrides[0].requireApproval).toBe(true);
  });

  it('removes persona override', () => {
    useApprovalStore.getState().addPersonaOverride({
      personaId: 'coder',
      requireApproval: false,
      autoApproveTools: [],
      alwaysApproveTools: [],
    });
    useApprovalStore.getState().removePersonaOverride('coder');
    expect(useApprovalStore.getState().policy.personaOverrides).toHaveLength(0);
  });

  it('persona override auto-approve bypasses approval', () => {
    useApprovalStore.getState().addPersonaOverride({
      personaId: 'coder',
      autoApproveTools: ['some_tool'],
      alwaysApproveTools: [],
    });
    expect(needsApprovalWithContext('some_tool', {}, 'coder')).toBe(false);
  });

  it('persona override requireApproval forces approval', () => {
    useApprovalStore.getState().addPersonaOverride({
      personaId: 'strict',
      requireApproval: true,
      autoApproveTools: [],
      alwaysApproveTools: [],
    });
    expect(needsApprovalWithContext('read_file', {}, 'strict')).toBe(true);
  });
});

describe('risk-aware request creation', () => {
  it('stores riskLevel and riskReasons on request', () => {
    const id = useApprovalStore.getState().createRequest({
      title: 'Dangerous',
      description: 'rm command',
      toolName: 'ssh_exec',
      riskLevel: 'critical',
      riskReasons: ['destructive command', 'targets root'],
    });

    const req = useApprovalStore.getState().getRequest(id);
    expect(req!.riskLevel).toBe('critical');
    expect(req!.riskReasons).toEqual(['destructive command', 'targets root']);
  });
});
