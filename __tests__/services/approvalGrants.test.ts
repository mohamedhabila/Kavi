import {
  buildApprovalGrantCandidate,
  hasMatchingActiveApprovalGrant,
  normalizePersistedAllowlist,
} from '../../src/services/remote/approvalGrants';

describe('approval grants', () => {
  it('derives a bounded native grant without persisting raw arguments', () => {
    const candidate = buildApprovalGrantCandidate({
      toolName: 'notification_send',
      args: { title: 'Private title', body: 'Private body' },
      riskLevel: 'low',
      destructive: false,
    });

    expect(candidate).toMatchObject({
      version: 1,
      toolName: 'notification_send',
      scope: 'native',
      actionClass: 'notification_send',
      targetKind: 'local-device',
    });
    expect(JSON.stringify(candidate)).not.toContain('Private title');
    expect(JSON.stringify(candidate)).not.toContain('Private body');
  });

  it('requires an exact remote target and safe executable for reusable SSH approval', () => {
    expect(
      buildApprovalGrantCandidate({
        toolName: 'ssh_exec',
        args: { command: 'pwd' },
        riskLevel: 'low',
        destructive: false,
      }),
    ).toBeUndefined();

    expect(
      buildApprovalGrantCandidate({
        toolName: 'ssh_exec',
        targetId: 'staging-host',
        args: { command: 'pwd' },
        riskLevel: 'low',
        destructive: false,
      }),
    ).toMatchObject({
      actionClass: 'pwd',
      targetKind: 'ssh-host',
      targetId: 'staging-host',
    });

    expect(
      buildApprovalGrantCandidate({
        toolName: 'ssh_exec',
        targetId: 'staging-host',
        args: { command: 'rm -rf /tmp/data' },
        riskLevel: 'critical',
        destructive: true,
      }),
    ).toBeUndefined();

    for (const command of [
      'env TASK=inspect pwd',
      'bash -c pwd',
      'git status',
      'pwd; whoami',
      'pwd $(whoami)',
      'rg --pre dangerous-command pattern',
      'sort --compress-program=dangerous-command file',
      'hostname renamed-host',
      'date --set tomorrow',
    ]) {
      expect(
        buildApprovalGrantCandidate({
          toolName: 'ssh_exec',
          targetId: 'staging-host',
          args: { command },
          riskLevel: 'low',
          destructive: false,
        }),
      ).toBeUndefined();
    }
  });

  it('matches active user grants only for the same action and target', () => {
    const candidate = buildApprovalGrantCandidate({
      toolName: 'ssh_exec',
      targetId: 'staging-host',
      args: { command: 'pwd' },
      riskLevel: 'low',
      destructive: false,
    });
    expect(candidate).toBeDefined();

    const allowlist = [
      {
        ...candidate!,
        addedAt: 10,
        status: 'active' as const,
        source: 'user' as const,
        sourceRequestId: 'approval-1',
      },
    ];

    expect(
      hasMatchingActiveApprovalGrant({
        allowlist,
        toolName: 'ssh_exec',
        args: { command: 'pwd', targetId: 'staging-host' },
        riskLevel: 'low',
        destructive: false,
      }),
    ).toBe(true);
    expect(
      hasMatchingActiveApprovalGrant({
        allowlist,
        toolName: 'ssh_exec',
        args: { command: 'pwd', targetId: 'production-host' },
        riskLevel: 'low',
        destructive: false,
      }),
    ).toBe(false);
    expect(
      hasMatchingActiveApprovalGrant({
        allowlist,
        toolName: 'ssh_exec',
        args: { command: 'git status', targetId: 'staging-host' },
        riskLevel: 'medium',
        destructive: false,
      }),
    ).toBe(false);
  });

  it('migrates broad legacy entries to review-required instead of active access', () => {
    const migrated = normalizePersistedAllowlist([
      { key: 'ssh_exec', addedAt: 10, personaId: 'operator' },
    ]);

    expect(migrated).toEqual([
      expect.objectContaining({
        toolName: 'ssh_exec',
        status: 'review-required',
        source: 'legacy',
        legacyKey: 'ssh_exec',
        personaId: 'operator',
      }),
    ]);
    expect(normalizePersistedAllowlist(migrated)).toEqual(migrated);
  });

  it('rehydrates only valid user grants as active', () => {
    const candidate = buildApprovalGrantCandidate({
      toolName: 'notification_send',
      riskLevel: 'low',
      destructive: false,
    });
    expect(candidate).toBeDefined();

    const activeGrant = {
      ...candidate!,
      addedAt: 10,
      status: 'active' as const,
      source: 'user' as const,
      sourceRequestId: 'approval-1',
    };
    expect(normalizePersistedAllowlist([activeGrant])).toEqual([activeGrant]);
    expect(
      normalizePersistedAllowlist([{ ...activeGrant, key: `${activeGrant.key}-tampered` }]),
    ).toEqual([]);
  });

  it('does not rehydrate internal bypass entries as active permissions', () => {
    expect(
      normalizePersistedAllowlist([
        {
          version: 1,
          key: 'calendar_list',
          toolName: 'calendar_list',
          scope: 'native',
          actionClass: '*',
          targetKind: 'tool',
          addedAt: 10,
          status: 'active',
          source: 'internal',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        status: 'review-required',
        source: 'legacy',
        legacyKey: 'calendar_list',
      }),
    ]);
  });
});
