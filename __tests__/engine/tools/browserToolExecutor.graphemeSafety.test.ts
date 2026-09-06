const mockStartBrowserTrace = jest.fn().mockReturnValue('');

jest.mock('../../../src/services/browser/traceStore', () => ({
  startBrowserTrace: (...args: unknown[]) => mockStartBrowserTrace(...args),
  completeBrowserTrace: jest.fn(),
}));

jest.mock('../../../src/services/browser/automation/actions', () => ({
  browserNavigate: jest.fn(),
  browserAct: jest.fn().mockResolvedValue({ ok: true }),
  browserScreenshot: jest.fn(),
  browserSnapshot: jest.fn(),
  browserSessionStatus: jest.fn(),
  browserFillForm: jest.fn(),
}));

jest.mock('../../../src/services/browser/automation/artifacts', () => ({
  browserUpload: jest.fn(),
  browserDownload: jest.fn(),
  browserPdf: jest.fn(),
  browserDialog: jest.fn(),
}));

jest.mock('../../../src/services/browser/automation/state', () => ({
  browserSetCookies: jest.fn(),
  browserClearCookies: jest.fn(),
  browserGetCookies: jest.fn(),
  browserStorageGet: jest.fn(),
  browserStorageSet: jest.fn(),
  browserStorageClear: jest.fn(),
}));

jest.mock('../../../src/services/browser/automation/trace', () => ({
  browserConsoleMessages: jest.fn(),
  browserPageErrors: jest.fn(),
  browserNetworkRequests: jest.fn(),
}));

jest.mock('../../../src/services/browser/jobs', () => ({
  launchBrowserLiveSession: jest.fn(),
  stopBrowserLiveSession: jest.fn(),
}));

import { executeBrowserTool } from '../../../src/engine/tools/browserToolExecutor';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeBrowserTool(browser_type) — trace description grapheme safety', () => {
  beforeEach(() => {
    mockStartBrowserTrace.mockClear();
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 30-char typed-text preview budget`, async () => {
      const text = buildBoundaryStraddlingText(30, cluster, 20);
      await executeBrowserTool('browser_type', {
        sessionId: 'session-1',
        ref: 'ref-1',
        text,
      });

      expect(mockStartBrowserTrace).toHaveBeenCalledTimes(1);
      const description = mockStartBrowserTrace.mock.calls[0][2] as string;
      expectGraphemeSafe(description);
    });
  }
});
