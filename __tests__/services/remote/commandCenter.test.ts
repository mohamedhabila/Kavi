// ---------------------------------------------------------------------------
// Tests — Remote Command Center (updated snapshot)
// ---------------------------------------------------------------------------

import { buildRemoteCommandCenterSnapshot } from '../../../src/services/remote/commandCenter';
import type { AppSettings } from '../../../src/types/settings';
import type { RemoteJobRecord, RemoteSessionRecord } from '../../../src/types/remote';

function makeSettings(
  overrides: Partial<AppSettings> = {},
): Pick<AppSettings, 'mcpServers' | 'sshTargets' | 'workspaceTargets' | 'browserProviders'> {
  return {
    mcpServers: overrides.mcpServers || [],
    sshTargets: overrides.sshTargets || [],
    workspaceTargets: overrides.workspaceTargets || [],
    browserProviders: overrides.browserProviders || [],
  };
}

function makeJob(overrides: Partial<RemoteJobRecord> = {}): RemoteJobRecord {
  return {
    id: 'job-1',
    jobType: 'browser-job',
    status: 'running',
    requestedBy: 'agent',
    executionSurface: 'browser-job',
    summary: 'Test job',
    artifacts: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<RemoteSessionRecord> = {}): RemoteSessionRecord {
  return {
    id: 'session-1',
    targetId: 'target-1',
    kind: 'browser-live',
    status: 'connected',
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    summary: 'Test session',
    reconnectable: false,
    ...overrides,
  };
}

describe('buildRemoteCommandCenterSnapshot', () => {
  it('returns snapshot with jobs array', () => {
    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings());
    expect(snapshot.jobs).toBeDefined();
    expect(Array.isArray(snapshot.jobs)).toBe(true);
  });

  it('returns snapshot with activeCounts', () => {
    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings());
    expect(snapshot.activeCounts).toBeDefined();
    expect(typeof snapshot.activeCounts.jobs).toBe('number');
    expect(typeof snapshot.activeCounts.sessions).toBe('number');
  });

  it('includes remote jobs in snapshot', () => {
    const jobs = [makeJob({ id: 'j1' }), makeJob({ id: 'j2', status: 'completed' })];
    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings(), { remoteJobs: jobs });

    expect(snapshot.jobs).toHaveLength(2);
    expect(snapshot.activeCounts.jobs).toBe(1); // only 'running' counts
  });

  it('includes remote sessions in snapshot', () => {
    const sessions = [
      makeSession({ id: 's1', status: 'connected' }),
      makeSession({ id: 's2', status: 'closed' }),
    ];
    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings(), { remoteSessions: sessions });

    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.activeCounts.sessions).toBe(1); // only 'connected' counts
  });

  it('merges SSH sessions with remote store sessions without duplicates', () => {
    const sshSessions = [
      {
        id: 'ssh-sess-1',
        targetId: 'ssh-1',
        targetLabel: 'Dev Server',
        status: 'connected' as const,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    ];
    const remoteSessions = [makeSession({ id: 'browser-sess-1', kind: 'browser-live' })];

    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings(), {
      sshSessions,
      remoteSessions,
    });

    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.sessions.map((s) => s.id)).toContain('ssh-sess-1');
    expect(snapshot.sessions.map((s) => s.id)).toContain('browser-sess-1');
  });

  it('deduplicates sessions by id', () => {
    const sshSessions = [
      {
        id: 'dup-id',
        targetId: 'ssh-1',
        targetLabel: 'Dev',
        status: 'connected' as const,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    ];
    const remoteSessions = [makeSession({ id: 'dup-id', kind: 'ssh-shell' })];

    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings(), {
      sshSessions,
      remoteSessions,
    });

    // Should only keep one entry for 'dup-id'
    expect(snapshot.sessions.filter((s) => s.id === 'dup-id')).toHaveLength(1);
  });

  it('counts queued jobs as active', () => {
    const jobs = [
      makeJob({ id: 'j1', status: 'queued' }),
      makeJob({ id: 'j2', status: 'running' }),
      makeJob({ id: 'j3', status: 'completed' }),
      makeJob({ id: 'j4', status: 'failed' }),
    ];
    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings(), { remoteJobs: jobs });
    expect(snapshot.activeCounts.jobs).toBe(2);
  });

  it('counts connecting sessions as active', () => {
    const sessions = [
      makeSession({ id: 's1', status: 'connecting' }),
      makeSession({ id: 's2', status: 'connected' }),
      makeSession({ id: 's3', status: 'error' }),
      makeSession({ id: 's4', status: 'closed' }),
    ];
    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings(), { remoteSessions: sessions });
    expect(snapshot.activeCounts.sessions).toBe(2);
  });

  it('still counts browser provider readyCounts correctly', () => {
    const snapshot = buildRemoteCommandCenterSnapshot({
      ...makeSettings(),
      browserProviders: [
        {
          id: 'bp-1',
          name: 'Browser',
          provider: 'browserbase',
          baseUrl: 'https://api.browserbase.com',
          authMode: 'api-key-header',
          apiKeyRef: 'ref1',
          projectId: 'p1',
          enabled: true,
        },
      ],
    });
    expect(snapshot.readyCounts.browser).toBe(1);
    expect(snapshot.enabledCounts.browser).toBe(1);
  });

  it('still counts workspace readyCounts correctly', () => {
    const snapshot = buildRemoteCommandCenterSnapshot({
      ...makeSettings(),
      workspaceTargets: [
        {
          id: 'ws-1',
          name: 'Workspace',
          rootPath: '/src',
          baseUrl: 'https://code.example.com',
          provider: 'code-server',
          enabled: true,
        },
      ],
    });
    expect(snapshot.readyCounts.workspace).toBe(1);
    expect(snapshot.enabledCounts.workspace).toBe(1);
  });

  it('handles empty options gracefully', () => {
    const snapshot = buildRemoteCommandCenterSnapshot(makeSettings());
    expect(snapshot.targets).toEqual([]);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.jobs).toEqual([]);
    expect(snapshot.activeCounts.jobs).toBe(0);
    expect(snapshot.activeCounts.sessions).toBe(0);
  });
});
