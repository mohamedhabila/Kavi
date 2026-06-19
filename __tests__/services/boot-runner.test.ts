// ---------------------------------------------------------------------------
// Boot Runner — tests
// ---------------------------------------------------------------------------

// Track mock state
let mockBootFileExists = false;
let mockBootFileContent = '';

jest.mock('expo-file-system', () => ({
  Paths: { document: '/mock/docs' },
  File: jest.fn().mockImplementation((_dir: any, _name: string) => ({
    text: jest.fn(() => mockBootFileContent),
    write: jest.fn((content: string) => {
      mockBootFileContent = content;
    }),
    get exists() {
      return mockBootFileExists;
    },
    name: _name,
  })),
  Directory: jest.fn().mockImplementation((_base: any, _name: string) => ({
    list: jest.fn().mockReturnValue([]),
    create: jest.fn(),
    get exists() {
      return true;
    },
  })),
}));

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn().mockImplementation((_opts: any, callbacks: any) => {
    callbacks.onToken?.('boot output');
    callbacks.onDone?.();
    return Promise.resolve();
  }),
  MAX_TOOL_ITERATIONS: 25,
}));

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn().mockReturnValue('mock-id'),
}));

import {
  readBootMd,
  writeBootMd,
  hasBootMd,
  runBootOnce,
  getBootConfig,
  updateBootConfig,
} from '../../src/services/agents/bootRunner';
import type { LlmProviderConfig } from '../../src/types/provider';

const mockProvider: LlmProviderConfig = {
  id: 'test',
  name: 'Test',
  type: 'openai' as any,
  apiKey: 'key',
  baseUrl: 'http://test',
  model: 'gpt-5.4',
  models: ['gpt-5.4'],
  enabled: true,
};

describe('Boot Runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBootFileExists = false;
    mockBootFileContent = '';
    // Reset boot config to allow running
    updateBootConfig({ enabled: true, lastRunAt: undefined, lastStatus: undefined });
  });

  describe('hasBootMd', () => {
    it('returns false when BOOT.md missing', async () => {
      mockBootFileExists = false;
      const result = await hasBootMd();
      expect(result).toBe(false);
    });

    it('returns false when BOOT.md exists but empty', async () => {
      mockBootFileExists = true;
      mockBootFileContent = '';
      const result = await hasBootMd();
      expect(result).toBe(false);
    });
  });

  describe('readBootMd', () => {
    it('returns null if BOOT.md does not exist', async () => {
      mockBootFileExists = false;
      const content = await readBootMd();
      expect(content).toBeNull();
    });
  });

  describe('writeBootMd', () => {
    it('writes content without error', () => {
      expect(() => writeBootMd('# New Boot\nDo things')).not.toThrow();
    });
  });

  describe('getBootConfig / updateBootConfig', () => {
    it('returns default config', () => {
      const cfg = getBootConfig();
      expect(cfg.enabled).toBe(true);
    });

    it('updates config', () => {
      updateBootConfig({ enabled: false });
      const cfg = getBootConfig();
      expect(cfg.enabled).toBe(false);
    });
  });

  describe('runBootOnce', () => {
    it('skips when disabled', async () => {
      updateBootConfig({ enabled: false });
      const result = await runBootOnce(mockProvider);
      expect(result.status).toBe('skipped');
    });

    it('skips when no BOOT.md content', async () => {
      mockBootFileExists = false;
      const result = await runBootOnce(mockProvider);
      expect(result.status).toBe('skipped');
    });

    it('skips when BOOT.md is empty string', async () => {
      mockBootFileExists = true;
      mockBootFileContent = '   ';
      const result = await runBootOnce(mockProvider);
      expect(result.status).toBe('skipped');
    });

    it('runs boot successfully with content', async () => {
      mockBootFileExists = true;
      mockBootFileContent = '# Boot\nRun setup tasks';
      const result = await runBootOnce(mockProvider);
      expect(result.status).toBe('ran');
      expect(result.output).toBeDefined();
    });

    it('uses an explicit boot model instead of the provider default when one is supplied', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      mockBootFileExists = true;
      mockBootFileContent = '# Boot\nRun setup tasks';

      const result = await runBootOnce(mockProvider, [mockProvider], 'gpt-4o-mini');

      expect(result.status).toBe('ran');
      expect(runOrchestrator).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: {
            ...mockProvider,
            model: 'gpt-4o-mini',
          },
          model: 'gpt-4o-mini',
        }),
        expect.any(Object),
      );
    });

    it('skips on repeated run within 60s', async () => {
      mockBootFileExists = true;
      mockBootFileContent = '# Boot\nSetup';
      const r1 = await runBootOnce(mockProvider);
      expect(r1.status).toBe('ran');
      const r2 = await runBootOnce(mockProvider);
      expect(r2.status).toBe('skipped');
      expect(r2.reason).toContain('already ran');
    });

    it('handles orchestrator error gracefully', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onError?.(new Error('LLM failed'));
        return Promise.reject(new Error('LLM failed'));
      });
      // Reset last run so it tries again
      updateBootConfig({ enabled: true, lastRunAt: undefined });
      mockBootFileExists = true;
      mockBootFileContent = '# Boot\nDo things';
      const result = await runBootOnce(mockProvider);
      expect(result.status).toBe('failed');
      expect(result.reason).toContain('LLM failed');
    });

    it('clears the boot timeout when the orchestrator errors early', async () => {
      jest.useFakeTimers();
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onError?.(new Error('LLM failed'));
        return Promise.reject(new Error('LLM failed'));
      });

      try {
        updateBootConfig({ enabled: true, lastRunAt: undefined });
        mockBootFileExists = true;
        mockBootFileContent = '# Boot\nDo things';

        const result = await runBootOnce(mockProvider);
        expect(result.status).toBe('failed');
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('passes allProviders when provided', async () => {
      updateBootConfig({ enabled: true, lastRunAt: undefined });
      mockBootFileExists = true;
      mockBootFileContent = '# Boot\nMulti-provider';
      const result = await runBootOnce(mockProvider, [mockProvider]);
      expect(result.status).toBe('ran');
    });
  });

  describe('readBootMd / hasBootMd', () => {
    it('hasBootMd returns true when content exists', async () => {
      mockBootFileExists = true;
      mockBootFileContent = '# Boot Instructions';
      expect(await hasBootMd()).toBe(true);
    });

    it('readBootMd returns content when exists', async () => {
      mockBootFileExists = true;
      mockBootFileContent = '# Boot';
      const content = await readBootMd();
      expect(content).toBe('# Boot');
    });
  });
});
