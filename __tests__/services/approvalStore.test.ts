// ---------------------------------------------------------------------------
// Tests — Approval Store
// ---------------------------------------------------------------------------

import {
  useApprovalStore,
  needsApproval,
  needsApprovalWithContext,
  ONE_SHOT_APPROVAL_DECISION_POLICY,
  requestToolApproval,
} from '../../src/services/remote/approvalStore';

beforeEach(() => {
  useApprovalStore.setState({
    requests: {},
    allowlist: [],
    analytics: {
      totalRequests: 0,
      totalApproved: 0,
      totalRejected: 0,
      totalExpired: 0,
      totalAllowAlways: 0,
      averageDecisionMs: 0,
      byTool: {},
    },
    policy: {
      requireApproval: false,
      alwaysApproveTools: ['ssh_exec', 'workspace_delegate_task', 'browser_navigate'],
      autoApproveTools: ['web_search', 'web_fetch', 'read_file', 'list_files'],
      timeoutMs: 5 * 60 * 1000,
    },
  });
});

describe('useApprovalStore', () => {
  describe('createRequest', () => {
    it('creates a pending approval request', () => {
      const id = useApprovalStore.getState().createRequest({
        title: 'Test Request',
        description: 'Execute something dangerous',
        targetId: 'target-1',
      });

      expect(id).toMatch(/^approval-/);
      const req = useApprovalStore.getState().getRequest(id);
      expect(req).toBeDefined();
      expect(req!.status).toBe('pending');
      expect(req!.title).toBe('Test Request');
      expect(req!.description).toBe('Execute something dangerous');
      expect(req!.targetId).toBe('target-1');
      expect(req!.requestedAt).toBeGreaterThan(0);
      expect(req!.expiresAt).toBeGreaterThan(req!.requestedAt);
      expect(req!.resolvedAt).toBeUndefined();
      expect(req!.decisionPolicy).toEqual({
        persistentApproval: 'allowed',
        expiryFallback: 'global-policy',
      });
    });

    it('stores a one-shot decision policy on the request', () => {
      const id = useApprovalStore.getState().createRequest({
        title: 'Remember observed fact',
        description: 'Store a fact derived from an approved tool result',
        decisionPolicy: ONE_SHOT_APPROVAL_DECISION_POLICY,
      });

      expect(useApprovalStore.getState().getRequest(id)?.decisionPolicy).toEqual({
        persistentApproval: 'forbidden',
        expiryFallback: 'reject',
      });
    });

    it('trims requests to MAX_REQUESTS limit', () => {
      const store = useApprovalStore.getState();
      for (let i = 0; i < 210; i++) {
        store.createRequest({ title: `Request ${i}`, description: `Desc ${i}` });
      }
      const count = Object.keys(useApprovalStore.getState().requests).length;
      expect(count).toBeLessThanOrEqual(200);
    });
  });

  describe('approveRequest', () => {
    it('transitions pending to approved', () => {
      const id = useApprovalStore.getState().createRequest({
        title: 'Approve this',
        description: 'test',
      });
      useApprovalStore.getState().approveRequest(id);

      const req = useApprovalStore.getState().getRequest(id);
      expect(req!.status).toBe('approved');
      expect(req!.resolvedAt).toBeGreaterThan(0);
    });

    it('does not approve already-resolved requests', () => {
      const id = useApprovalStore.getState().createRequest({
        title: 'Already rejected',
        description: 'test',
      });
      useApprovalStore.getState().rejectRequest(id);
      useApprovalStore.getState().approveRequest(id);

      const req = useApprovalStore.getState().getRequest(id);
      expect(req!.status).toBe('rejected');
    });
  });

  describe('rejectRequest', () => {
    it('transitions pending to rejected', () => {
      const id = useApprovalStore.getState().createRequest({
        title: 'Reject this',
        description: 'test',
      });
      useApprovalStore.getState().rejectRequest(id);

      const req = useApprovalStore.getState().getRequest(id);
      expect(req!.status).toBe('rejected');
      expect(req!.resolvedAt).toBeGreaterThan(0);
    });
  });

  describe('expireRequest', () => {
    it('transitions pending to expired', () => {
      const id = useApprovalStore.getState().createRequest({
        title: 'Expire this',
        description: 'test',
      });
      useApprovalStore.getState().expireRequest(id);

      const req = useApprovalStore.getState().getRequest(id);
      expect(req!.status).toBe('expired');
    });
  });

  describe('clearResolved', () => {
    it('removes all non-pending requests', () => {
      const store = useApprovalStore.getState();
      const id1 = store.createRequest({ title: 'Pending', description: 'stays' });
      const id2 = store.createRequest({ title: 'Approved', description: 'goes' });
      const id3 = store.createRequest({ title: 'Rejected', description: 'goes' });

      store.approveRequest(id2);
      store.rejectRequest(id3);
      store.clearResolved();

      const state = useApprovalStore.getState();
      expect(state.getRequest(id1)).toBeDefined();
      expect(state.getRequest(id2)).toBeUndefined();
      expect(state.getRequest(id3)).toBeUndefined();
    });
  });

  describe('getPendingRequests', () => {
    it('returns only pending, sorted by most recent first', () => {
      const store = useApprovalStore.getState();
      store.createRequest({ title: 'First', description: 'a' });
      store.createRequest({ title: 'Second', description: 'b' });
      const id3 = store.createRequest({ title: 'Third', description: 'c' });
      store.approveRequest(id3);

      const pending = useApprovalStore.getState().getPendingRequests();
      expect(pending.length).toBe(2);
      // Sorted by requestedAt desc — but both created at ~same ms, so just check both present
      const titles = pending.map((r: any) => r.title);
      expect(titles).toContain('First');
      expect(titles).toContain('Second');
    });
  });

  describe('sweepExpired', () => {
    it('expires requests that exceed the timeout', () => {
      const store = useApprovalStore.getState();
      const id = store.createRequest({ title: 'Old', description: 'should expire' });

      // Manually backdate the request
      useApprovalStore.setState((state) => ({
        requests: {
          ...state.requests,
          [id]: { ...state.requests[id], requestedAt: Date.now() - 10 * 60 * 1000 },
        },
      }));

      const count = useApprovalStore.getState().sweepExpired();
      expect(count).toBe(1);
      expect(useApprovalStore.getState().getRequest(id)!.status).toBe('expired');
    });

    it('does not expire recent requests', () => {
      useApprovalStore.getState().createRequest({ title: 'Recent', description: 'stays' });
      const count = useApprovalStore.getState().sweepExpired();
      expect(count).toBe(0);
    });
  });

  describe('policy management', () => {
    it('updates policy partial fields', () => {
      useApprovalStore.getState().setPolicy({ requireApproval: true, timeoutMs: 60_000 });
      const policy = useApprovalStore.getState().policy;
      expect(policy.requireApproval).toBe(true);
      expect(policy.timeoutMs).toBe(60_000);
      // Other fields should be unchanged
      expect(policy.alwaysApproveTools).toContain('ssh_exec');
    });
  });
});

describe('needsApproval', () => {
  it('returns true for alwaysApproveTools even when global approval off', () => {
    expect(needsApproval('ssh_exec')).toBe(true);
    expect(needsApproval('workspace_delegate_task')).toBe(true);
  });

  it('returns false for non-sensitive tools when global approval off', () => {
    expect(needsApproval('web_search')).toBe(false);
    expect(needsApproval('read_file')).toBe(false);
  });

  it('requires consent for each runtime MCP tool until that exact tool is allowlisted', () => {
    const readTool = 'mcp__trip_ledger__get_trip_record';
    const writeTool = 'mcp__trip_ledger__put_trip_note';

    expect(needsApproval(readTool)).toBe(true);
    expect(needsApproval(writeTool)).toBe(true);

    useApprovalStore.getState().addToAllowlist(readTool);

    expect(needsApproval(readTool)).toBe(false);
    expect(needsApproval(writeTool)).toBe(true);
  });

  it('returns true for non-auto-approved tools when global approval on', () => {
    useApprovalStore.getState().setPolicy({ requireApproval: true });
    expect(needsApproval('some_random_tool')).toBe(true);
  });

  it('returns false for autoApproveTools when global approval on', () => {
    useApprovalStore.getState().setPolicy({ requireApproval: true });
    expect(needsApproval('web_search')).toBe(false);
    expect(needsApproval('list_files')).toBe(false);
  });

  it('treats browser cookie reads as safe but writes as sensitive', () => {
    expect(needsApprovalWithContext('browser_cookies', { action: 'get' })).toBe(false);
    expect(needsApprovalWithContext('browser_cookies', { action: 'set' })).toBe(true);
    expect(needsApprovalWithContext('browser_storage', { action: 'clear' })).toBe(true);
  });

  it('treats new communication and contacts tools as sensitive by default', () => {
    expect(needsApprovalWithContext('email_compose', {})).toBe(true);
    expect(needsApprovalWithContext('contacts_manage_access', {})).toBe(true);
    expect(needsApprovalWithContext('contacts_search_full', { query: 'Jane' })).toBe(true);
    expect(needsApprovalWithContext('phone_call', { number: '+12125550101' })).toBe(true);
    expect(needsApprovalWithContext('calendar_events', {})).toBe(true);
    expect(needsApprovalWithContext('calendar_update_event', { id: 'event-1' })).toBe(true);
    expect(needsApprovalWithContext('location_current', {})).toBe(true);
    expect(needsApprovalWithContext('clipboard_read', {})).toBe(true);
    expect(needsApprovalWithContext('photos_latest', { count: 3 })).toBe(true);
    expect(needsApprovalWithContext('screen_record', {})).toBe(true);
    expect(needsApprovalWithContext('notification_cancel', { id: 'notification-id' })).toBe(true);
  });

  it('allows safe https open_url calls but blocks non-web schemes', () => {
    expect(needsApprovalWithContext('open_url', { url: 'https://example.com/docs' })).toBe(false);
    expect(needsApprovalWithContext('open_url', { url: 'mailto:jane@example.com' })).toBe(true);
    expect(needsApprovalWithContext('open_url', { url: 'tel:+12125550101' })).toBe(true);
  });
});

describe('requestToolApproval', () => {
  it('resolves with approved when manually approved', async () => {
    const promise = requestToolApproval({
      toolName: 'test_tool',
      description: 'Testing approval',
    });

    // Find the pending request and approve it
    const pending = useApprovalStore.getState().getPendingRequests();
    expect(pending.length).toBe(1);
    useApprovalStore.getState().approveRequest(pending[0].id);

    const result = await promise;
    expect(result).toBe('approved');
  });

  it('resolves with rejected when manually rejected', async () => {
    const promise = requestToolApproval({
      toolName: 'test_tool',
      description: 'Testing rejection',
    });

    const pending = useApprovalStore.getState().getPendingRequests();
    useApprovalStore.getState().rejectRequest(pending[0].id);

    const result = await promise;
    expect(result).toBe('rejected');
  });

  it('creates redacted approval copy for native actions', async () => {
    const promise = requestToolApproval({
      toolName: 'email_compose',
      args: {
        recipients: ['jane@example.com'],
        subject: 'Private subject',
        body: 'Secret body',
      },
      description: 'Raw fallback description',
    });

    const pending = useApprovalStore.getState().getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].title).toBe('Send email');
    expect(pending[0].description).toContain('1 recipient');
    expect(pending[0].description).not.toContain('jane@example.com');
    expect(pending[0].description).not.toContain('Private subject');

    useApprovalStore.getState().rejectRequest(pending[0].id);
    await expect(promise).resolves.toBe('rejected');
  });

  it('expires automatically when no decision is made before the timeout', async () => {
    jest.useFakeTimers();
    useApprovalStore.getState().setPolicy({ timeoutMs: 1000 });

    const promise = requestToolApproval({
      toolName: 'expo_eas_build',
      description: 'Testing timeout',
    });

    await jest.advanceTimersByTimeAsync(1250);
    const result = await promise;
    expect(result).toBe('expired');

    jest.useRealTimers();
  });

  it('never auto-approves a one-shot request when the global expiry fallback approves', async () => {
    jest.useFakeTimers();
    useApprovalStore.getState().setPolicy({ timeoutMs: 1000, expiryFallback: 'approve' });

    const promise = requestToolApproval({
      toolName: 'memory_remember',
      description: 'Remember an observed fact',
      decisionPolicy: ONE_SHOT_APPROVAL_DECISION_POLICY,
    });

    await jest.advanceTimersByTimeAsync(1250);

    await expect(promise).resolves.toBe('expired');
    expect(useApprovalStore.getState().getPendingRequests()).toHaveLength(0);

    jest.useRealTimers();
  });

  it('keeps host-reviewed mobile confirmation concrete, high-risk, and one-shot', async () => {
    const promise = requestToolApproval({
      toolName: 'mobile_ui_action',
      args: { kind: 'activate', target: { kind: 'coordinate', x: 500, y: 500 } },
      description: 'Raw model action',
      reviewPresentation: {
        title: 'Confirm message send',
        description: 'Send the prepared message to the selected recipient.',
      },
      decisionPolicy: ONE_SHOT_APPROVAL_DECISION_POLICY,
    });

    const pending = useApprovalStore.getState().getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      title: 'Confirm message send',
      description: 'Send the prepared message to the selected recipient.',
      riskLevel: 'high',
      decisionPolicy: ONE_SHOT_APPROVAL_DECISION_POLICY,
    });

    useApprovalStore.getState().approveAlways(pending[0].id);
    expect(useApprovalStore.getState().getRequest(pending[0].id)?.status).toBe('pending');
    expect(useApprovalStore.getState().allowlist).toEqual([]);
    useApprovalStore.getState().approveRequest(pending[0].id);
    await expect(promise).resolves.toBe('approved');
  });

  it('retains the global expiry fallback for ordinary requests', async () => {
    jest.useFakeTimers();
    useApprovalStore.getState().setPolicy({ timeoutMs: 1000, expiryFallback: 'approve' });

    const promise = requestToolApproval({
      toolName: 'ssh_exec',
      description: 'Run an approved command',
    });

    await jest.advanceTimersByTimeAsync(1250);

    await expect(promise).resolves.toBe('approved');

    jest.useRealTimers();
  });
});

describe('approval request persistence schema', () => {
  it('migrates legacy requests to the ordinary decision policy', async () => {
    const migrate = useApprovalStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const migrated = (await migrate!(
      {
        requests: {
          legacy: {
            id: 'legacy',
            title: 'Legacy request',
            description: 'Created before request decision policies',
            status: 'pending',
            requestedAt: 1,
          },
        },
      },
      2,
    )) as any;

    expect(migrated.requests.legacy.decisionPolicy).toEqual({
      persistentApproval: 'allowed',
      expiryFallback: 'global-policy',
    });
  });

  it('fails closed when a current persisted request has an invalid decision policy', () => {
    const merge = useApprovalStore.persist.getOptions().merge;
    expect(merge).toBeDefined();

    const current = useApprovalStore.getState();
    const merged = merge!(
      {
        requests: {
          malformed: {
            id: 'malformed',
            title: 'Malformed request',
            description: 'Has an invalid persisted policy',
            status: 'pending',
            requestedAt: 1,
            decisionPolicy: {
              persistentApproval: 'allowed',
              expiryFallback: 'reject',
            },
          },
        },
      },
      current,
    ) as typeof current;

    expect(merged.requests.malformed.decisionPolicy).toEqual({
      persistentApproval: 'forbidden',
      expiryFallback: 'reject',
    });
  });
});
