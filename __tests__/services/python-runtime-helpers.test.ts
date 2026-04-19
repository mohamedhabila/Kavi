import {
  getDispatchAcknowledgementTimeoutMs,
  normalizeIndexUrls,
  normalizePackageSpecs,
  normalizePythonArgv,
  normalizePythonEnv,
  normalizePythonExecutionRequest,
  normalizeWorkspaceFiles,
  normalizeWorkspaceRelativePath,
  unrefTimerIfSupported,
} from '../../src/services/python/requestNormalization';
import { extractPep723Dependencies } from '../../src/services/python/scriptMetadata';

describe('python runtime helpers', () => {
  describe('normalizeWorkspaceRelativePath', () => {
    it('returns undefined for non-string or unsafe paths', () => {
      expect(normalizeWorkspaceRelativePath(undefined)).toBeUndefined();
      expect(normalizeWorkspaceRelativePath('../unsafe.py')).toBeUndefined();
      expect(normalizeWorkspaceRelativePath('')).toBeUndefined();
    });

    it('normalizes slash variants and trims empty segments', () => {
      expect(normalizeWorkspaceRelativePath('\\skills\\demo\\run.py')).toBe('skills/demo/run.py');
      expect(normalizeWorkspaceRelativePath('/skills//demo/run.py')).toBe('skills/demo/run.py');
    });
  });

  describe('normalizeWorkspaceFiles', () => {
    it('filters invalid entries and preserves valid base64 payloads', () => {
      expect(normalizeWorkspaceFiles(undefined)).toEqual([]);
      expect(
        normalizeWorkspaceFiles([
          { path: 'scripts/run.py', contentBase64: 'cHJpbnQoMSk=' },
          { path: '../unsafe.py', contentBase64: 'bad' },
          { path: 'missing-content.py' },
        ]),
      ).toEqual([{ path: 'scripts/run.py', contentBase64: 'cHJpbnQoMSk=' }]);
    });
  });

  describe('package and env normalization', () => {
    it('deduplicates packages and filters non-strings', () => {
      expect(normalizePackageSpecs(['requests', 'requests', 42 as any, 'httpx'])).toEqual([
        'requests',
        'httpx',
      ]);
    });

    it('deduplicates index urls and filters non-http values', () => {
      expect(
        normalizeIndexUrls([
          'https://packages.example/simple',
          'https://packages.example/simple',
          'ftp://ignored.example',
        ]),
      ).toEqual(['https://packages.example/simple']);
    });

    it('filters env and argv to supported values only', () => {
      expect(normalizePythonEnv({ KEY: 'value', BAD: 123 as any })).toEqual({ KEY: 'value' });
      expect(normalizePythonEnv('bad' as any)).toEqual({});
      expect(normalizePythonArgv(['--flag', 123 as any, 'value'])).toEqual(['--flag', 'value']);
    });
  });

  describe('normalizePythonExecutionRequest', () => {
    it('validates mutually exclusive inline code and script paths', () => {
      expect(normalizePythonExecutionRequest({})).toEqual({
        error: 'Python execution requires either inline code or a scriptPath.',
      });
      expect(
        normalizePythonExecutionRequest({ code: 'print(1)', scriptPath: 'scripts/run.py' }),
      ).toEqual({
        error: 'Python execution accepts either inline code or a scriptPath, not both.',
      });
    });

    it('rejects unsafe paths and working directories', () => {
      expect(normalizePythonExecutionRequest({ scriptPath: '../unsafe.py' })).toEqual({
        error: 'Python execution requires a safe workspace-relative scriptPath.',
      });
      expect(
        normalizePythonExecutionRequest({ code: 'print(1)', workingDirectory: '../unsafe' }),
      ).toEqual({
        error: 'Python execution requires a safe workspace-relative workingDirectory.',
      });
    });

    it('normalizes a valid request and applies defaults', () => {
      const normalized = normalizePythonExecutionRequest({
        code: 'print(1)',
        argv: ['--flag', 123 as any, 'value'],
        files: [
          { path: 'scripts/run.py', contentBase64: 'cHJpbnQoMSk=' },
          { path: '../bad.py', contentBase64: 'bad' } as any,
        ],
        packages: ['requests', 'requests', 42 as any, 'httpx'],
        indexUrls: ['https://packages.example/simple', 'ftp://ignored.example'],
        env: { KEY: 'value', BAD: 123 as any },
      } as any);

      expect(normalized.error).toBeUndefined();
      expect(normalized.request).toEqual({
        code: 'print(1)',
        scriptPath: undefined,
        argv: ['--flag', 'value'],
        files: [{ path: 'scripts/run.py', contentBase64: 'cHJpbnQoMSk=' }],
        workingDirectory: '',
        packages: ['requests', 'httpx'],
        indexUrls: ['https://packages.example/simple'],
        env: { KEY: 'value' },
        timeoutMs: 300000,
      });
    });
  });

  describe('timers and metadata helpers', () => {
    it('clamps dispatch acknowledgement timeout into the supported range', () => {
      expect(getDispatchAcknowledgementTimeoutMs(Number.NaN)).toBe(5000);
      expect(getDispatchAcknowledgementTimeoutMs(100)).toBe(250);
      expect(getDispatchAcknowledgementTimeoutMs(1000)).toBe(1000);
      expect(getDispatchAcknowledgementTimeoutMs(100000)).toBe(5000);
    });

    it('calls timer.unref when it is available', () => {
      const unref = jest.fn();
      unrefTimerIfSupported({ unref } as any);
      expect(unref).toHaveBeenCalledTimes(1);

      expect(() => unrefTimerIfSupported({} as any)).not.toThrow();
    });
  });

  describe('extractPep723Dependencies', () => {
    it('returns an empty list when metadata is absent or malformed', () => {
      expect(extractPep723Dependencies('')).toEqual([]);
      expect(extractPep723Dependencies('# plain python')).toEqual([]);
      expect(extractPep723Dependencies('# /// script\n# name = "demo"\nprint(1)')).toEqual([]);
    });

    it('extracts sorted unique dependency strings from a valid metadata block', () => {
      const source = [
        '# /// script',
        '# dependencies = [',
        '#   "requests",',
        '#   "httpx",',
        '#   "requests",',
        '# ]',
        '# ///',
        'print("hi")',
      ].join('\n');

      expect(extractPep723Dependencies(source)).toEqual(['httpx', 'requests']);
    });
  });
});
