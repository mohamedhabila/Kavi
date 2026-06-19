// ---------------------------------------------------------------------------
// Tests — Browser Jobs (takeScreenshot)
// ---------------------------------------------------------------------------

// Also mock automation's sub-dependencies to avoid import chain issues
jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../src/services/browser/automation/actions', () => ({
  browserScreenshot: jest.fn(),
}));

import { takeScreenshot } from '../../../src/services/browser/jobs';
import { browserScreenshot } from '../../../src/services/browser/automation/actions';

const mockBrowserScreenshot = browserScreenshot as jest.MockedFunction<typeof browserScreenshot>;

// Mock the other dependencies that jobs.ts imports
jest.mock('../../../src/store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ browserProviders: [] }) },
}));
jest.mock('../../../src/services/remote/store', () => ({
  useRemoteStore: { getState: () => ({ sessions: {}, jobs: {} }) },
  openRemoteSession: jest.fn(() => 'sess-1'),
  closeRemoteSession: jest.fn(),
  startRemoteJob: jest.fn(() => 'job-1'),
  updateRemoteJob: jest.fn(),
  updateRemoteSession: jest.fn(),
  setRemoteSessionRuntime: jest.fn(),
  getRemoteSessionRuntime: jest.fn(),
  addRemoteArtifact: jest.fn(),
}));
jest.mock('../../../src/services/browser/providers/labels', () => ({
  getBrowserProviderLabel: jest.fn(() => 'Browserbase'),
}));

jest.mock('../../../src/services/browser/providers/readiness', () => ({
  getBrowserProviderReadiness: jest.fn(() => ({ launchable: true, reason: '' })),
}));

jest.mock('../../../src/services/browser/providers/connection', () => ({
  resolveBrowserProviderConnection: jest.fn(),
  withBrowserProviderAuth: jest.fn((url: string) => ({ url, headers: {} })),
}));

describe('takeScreenshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a data URI when browserScreenshot succeeds', async () => {
    mockBrowserScreenshot.mockResolvedValue({
      ok: true,
      imageBase64: 'iVBORw0KGgoAAAANSUhEUg==',
      targetId: 'target-1',
    });

    const result = await takeScreenshot('sess-1');
    expect(result).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
    expect(mockBrowserScreenshot).toHaveBeenCalledWith('sess-1');
  });

  it('returns null when imageBase64 is empty', async () => {
    mockBrowserScreenshot.mockResolvedValue({
      ok: true,
      imageBase64: '',
      targetId: 'target-1',
    });

    const result = await takeScreenshot('sess-1');
    expect(result).toBeNull();
  });

  it('throws when browserScreenshot throws', async () => {
    mockBrowserScreenshot.mockRejectedValue(new Error('session not found'));

    await expect(takeScreenshot('bad-sess')).rejects.toThrow('session not found');
  });
});
