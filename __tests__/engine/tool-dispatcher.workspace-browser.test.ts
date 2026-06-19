import {
  CONV_ID,
  setupToolDispatcherHarness,
  type ToolDispatcherHarness,
} from '../helpers/toolDispatcherHarness';

let executeTool: ToolDispatcherHarness['executeTool'];
let mockGetWorkspaceTargetControlStatus: ToolDispatcherHarness['mockGetWorkspaceTargetControlStatus'];
let mockLaunchWorkspaceBrowserSession: ToolDispatcherHarness['mockLaunchWorkspaceBrowserSession'];
let mockDelegateWorkspaceTask: ToolDispatcherHarness['mockDelegateWorkspaceTask'];
let mockBrowserScreenshot: ToolDispatcherHarness['mockBrowserScreenshot'];
let mockBrowserSnapshot: ToolDispatcherHarness['mockBrowserSnapshot'];
let mockBrowserNetworkRequests: ToolDispatcherHarness['mockBrowserNetworkRequests'];

beforeEach(() => {
  const harness = setupToolDispatcherHarness();
  executeTool = harness.executeTool;
  mockGetWorkspaceTargetControlStatus = harness.mockGetWorkspaceTargetControlStatus;
  mockLaunchWorkspaceBrowserSession = harness.mockLaunchWorkspaceBrowserSession;
  mockDelegateWorkspaceTask = harness.mockDelegateWorkspaceTask;
  mockBrowserScreenshot = harness.mockBrowserScreenshot;
  mockBrowserSnapshot = harness.mockBrowserSnapshot;
  mockBrowserNetworkRequests = harness.mockBrowserNetworkRequests;
});

describe('executeTool — core tools routing', () => {
  it('routes workspace_status and summarizes configured targets', async () => {
    const result = await executeTool('workspace_status', '{}', CONV_ID);

    expect(JSON.parse(result)).toMatchObject({
      summary: 'Found 1 configured workspace targets.',
      targets: [expect.objectContaining({ targetId: 'ws-1', summary: 'Workspace A is ready.' })],
    });
    expect(mockGetWorkspaceTargetControlStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws-1' }),
      expect.objectContaining({
        workspaceTargets: expect.any(Array),
      }),
    );
  });

  it('routes workspace_launch_browser with validated args', async () => {
    const result = await executeTool(
      'workspace_launch_browser',
      '{"targetId":"ws-1","providerId":"browser-1"}',
      CONV_ID,
    );

    expect(JSON.parse(result)).toMatchObject({
      summary: 'Workspace browser session launched for Workspace A.',
      targetId: 'ws-1',
      sessionId: 'workspace-browser-session-1',
      providerId: 'browser-1',
      url: 'https://workspace.example.com',
    });
    expect(mockLaunchWorkspaceBrowserSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws-1' }),
      expect.objectContaining({ providerId: 'browser-1' }),
    );
  });

  it('returns a friendly error when workspace_delegate_task prompt is missing', async () => {
    const result = await executeTool('workspace_delegate_task', '{"targetId":"ws-1"}', CONV_ID);

    expect(result).toContain('Error');
    expect(result).toContain('prompt');
    expect(mockDelegateWorkspaceTask).not.toHaveBeenCalled();
  });

  it('summarizes browser screenshots without returning base64 blobs', async () => {
    mockBrowserScreenshot.mockResolvedValueOnce({
      ok: true,
      targetId: 'page-2',
      url: 'https://example.com/app',
      imageBase64: 'A'.repeat(12000),
    });

    const result = await executeTool(
      'browser_screenshot',
      '{"sessionId":"browser-session-1"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary).toContain('Binary image omitted');
    expect(parsed.targetId).toBe('page-2');
    expect(parsed.imageBase64).toBeUndefined();
    expect(parsed.imageBytes).toBeGreaterThan(0);
  });

  it('keeps browser snapshots inspectable while trimming oversized page state', async () => {
    const largeSnapshot = `Hero heading\n${'Content line\n'.repeat(3000)}Footer note`;
    mockBrowserSnapshot.mockResolvedValueOnce({
      ok: true,
      targetId: 'page-3',
      snapshot: largeSnapshot,
      truncated: false,
    });

    const result = await executeTool(
      'browser_snapshot',
      '{"sessionId":"browser-session-1"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary).toContain('trimmed for context');
    expect(parsed.snapshotChars).toBe(largeSnapshot.length);
    expect(parsed.snapshot).toContain('Hero heading');
    expect(parsed.snapshot).toContain('Footer note');
    expect(parsed.truncated).toBe(true);
  });

  it('prioritizes failing browser network requests in summarized results', async () => {
    mockBrowserNetworkRequests.mockResolvedValueOnce({
      ok: true,
      targetId: 'page-4',
      requests: [
        { method: 'GET', url: 'https://example.com/ok', status: 200, resourceType: 'document' },
        { method: 'GET', url: 'https://example.com/fail', status: 502, resourceType: 'xhr' },
        {
          method: 'POST',
          url: 'https://example.com/also-fail',
          status: 500,
          resourceType: 'fetch',
        },
      ],
    });

    const result = await executeTool(
      'browser_network',
      '{"sessionId":"browser-session-1"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);

    expect(parsed.failedCount).toBe(2);
    expect(parsed.requests[0].status).toBeGreaterThanOrEqual(400);
  });

  it('routes workspace_delegate_task and returns the delegated output preview', async () => {
    const result = await executeTool(
      'workspace_delegate_task',
      '{"targetId":"ws-1","prompt":"Investigate build failures","mode":"agent"}',
      CONV_ID,
    );

    expect(JSON.parse(result)).toMatchObject({
      summary: 'Delegated task to Workspace A via Cursor CLI.',
      targetId: 'ws-1',
      sshTargetId: 'ssh-1',
      mode: 'agent',
      output: 'Delegated task completed successfully.',
      truncated: false,
    });
    expect(mockDelegateWorkspaceTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws-1' }),
      'Investigate build failures',
      expect.objectContaining({ mode: 'agent' }),
    );
  });
});
