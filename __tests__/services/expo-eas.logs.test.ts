import {
  account,
  mockExpoEasHarnessState,
  latin1Bytes,
  mockBrotliResponse,
  mockByteResponse,
  mockGzipResponse,
  resetExpoEasMocks,
  strToU8,
} from '../helpers/expoEasHarness';
import { inspectExpoWorkflowRun } from '../../src/services/expo/workflowMonitoring';
import {
  excerptWorkflowLogText,
  looksCompressed,
  stripAnsiAndControlChars,
} from '../../src/services/expo/logs/workflowText';

beforeEach(() => {
  resetExpoEasMocks();
});

describe('looksCompressed', () => {
  it('detects gzip magic bytes', () => {
    expect(looksCompressed(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);
  });

  it('detects zlib header 0x78 0x9c', () => {
    expect(looksCompressed(new Uint8Array([0x78, 0x9c, 0x01, 0x00]))).toBe(true);
  });

  it('detects zlib header 0x78 0x01', () => {
    expect(looksCompressed(new Uint8Array([0x78, 0x01, 0x01, 0x00]))).toBe(true);
  });

  it('detects zlib header 0x78 0xda', () => {
    expect(looksCompressed(new Uint8Array([0x78, 0xda, 0x01, 0x00]))).toBe(true);
  });

  it('returns false for plain text bytes', () => {
    expect(looksCompressed(strToU8('Hello world'))).toBe(false);
  });

  it('returns false for JSON bytes', () => {
    expect(looksCompressed(strToU8('{"msg":"test"}'))).toBe(false);
  });

  it('returns false for too-short buffers', () => {
    expect(looksCompressed(new Uint8Array([0x1f]))).toBe(false);
    expect(looksCompressed(new Uint8Array([]))).toBe(false);
  });
});

describe('stripAnsiAndControlChars', () => {
  it('strips ANSI color escape sequences', () => {
    expect(stripAnsiAndControlChars('\x1b[31mError\x1b[0m: something failed')).toBe(
      'Error: something failed',
    );
  });

  it('strips ANSI bold/underline sequences', () => {
    expect(stripAnsiAndControlChars('\x1b[1mBold\x1b[4mUnderline\x1b[0m')).toBe('BoldUnderline');
  });

  it('strips null bytes and other control chars', () => {
    expect(stripAnsiAndControlChars('line1\x00\x01\x02line2')).toBe('line1line2');
  });

  it('preserves newlines, tabs, and carriage returns', () => {
    // \n (0x0a), \r (0x0d), \t (0x09) should be kept
    expect(stripAnsiAndControlChars('line1\nline2\r\nline3\ttab')).toBe(
      'line1\nline2\r\nline3\ttab',
    );
  });

  it('returns clean text unchanged', () => {
    const clean = 'npm ERR! 404 @kavi/package not found';
    expect(stripAnsiAndControlChars(clean)).toBe(clean);
  });
});

describe('excerptWorkflowLogText', () => {
  it('strips ANSI before excerpting', () => {
    const log = '\x1b[31mERROR:\x1b[0m Module not found';
    const result = excerptWorkflowLogText(log);
    expect(result).not.toContain('\x1b');
    expect(result).toContain('ERROR: Module not found');
  });

  it('focuses around error patterns', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `step ${i}`);
    lines[50] = 'fatal error: something broke';
    const result = excerptWorkflowLogText(lines.join('\n'));
    expect(result).toContain('fatal error: something broke');
  });

  it('respects maxChars limit', () => {
    const longLog = Array.from({ length: 200 }, (_, i) => `line ${i}: ${'x'.repeat(50)}`).join(
      '\n',
    );
    const result = excerptWorkflowLogText(longLog, 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/…$/);
  });
});

describe('compressed log decompression', () => {
  beforeEach(() => {
    mockExpoEasHarnessState.settingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-gzip',
          easProjectId: 'eas-project-gzip',
          name: 'Gzip Logs',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/deploy.yml',
          availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };
  });

  it('decompresses gzip-compressed JSONL logs from EAS build', async () => {
    const logContent = [
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:01:00Z',
        msg: 'yarn install',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:01:04Z',
        msg: 'error @kavi/gzip-test: package not found',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        marker: 'END_PHASE',
        result: 'fail',
        time: '2026-01-02T00:01:05Z',
        msg: 'Command failed',
      }),
    ].join('\n');

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('expo.dev/graphql')) {
        const body = JSON.parse(init?.body);

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-gzip-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-gzip-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: {},
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-gzip-1',
                          logFileUrls: ['https://logs.expo.dev/gzip-test.ndjson'],
                          errors: [],
                        },
                        turtleBuild: null,
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        return { ok: true, status: 200, json: async () => ({ data: {} }) } as any;
      }

      // Return gzip-compressed log content for the log URL
      if (url === 'https://logs.expo.dev/gzip-test.ndjson') {
        return mockGzipResponse(logContent);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-gzip', {
      workflowRunId: 'workflow-run-gzip-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('@kavi/gzip-test: package not found'),
        }),
      ]),
    );
    // Ensure excerpt is clean text, not garbled binary
    for (const log of inspection.failureLogs || []) {
      expect(log.excerpt).not.toMatch(/[\x00-\x08\x0e-\x1f]/);
    }
  });

  it('decompresses Brotli-compressed JSONL logs from Expo-hosted workflows', async () => {
    const logContent = [
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:03:00Z',
        msg: 'npm ci',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:03:04Z',
        msg: 'error @kavi/brotli-test: package not found',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        marker: 'END_PHASE',
        result: 'fail',
        time: '2026-01-02T00:03:05Z',
        msg: 'Command failed with exit code 1',
      }),
    ].join('\n');

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('expo.dev/graphql')) {
        const body = JSON.parse(init?.body);

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-brotli-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-brotli-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: {},
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-brotli-1',
                          logFileUrls: ['https://logs.expo.dev/brotli-test.ndjson'],
                          errors: [],
                        },
                        turtleBuild: null,
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        return { ok: true, status: 200, json: async () => ({ data: {} }) } as any;
      }

      if (url === 'https://logs.expo.dev/brotli-test.ndjson') {
        return mockBrotliResponse(logContent);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-gzip', {
      workflowRunId: 'workflow-run-brotli-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('@kavi/brotli-test: package not found'),
        }),
      ]),
    );
    for (const log of inspection.failureLogs || []) {
      expect(log.excerpt).not.toMatch(/[\x00-\x08\x0e-\x1f]/);
    }
  });

  it('keeps readable log text when the runtime already decoded a Brotli response body', async () => {
    const logContent = [
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:04:00Z',
        msg: 'npm ci',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:04:04Z',
        msg: 'error @kavi/br-header-test: package not found',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        marker: 'END_PHASE',
        result: 'fail',
        time: '2026-01-02T00:04:05Z',
        msg: 'Command failed with exit code 1',
      }),
    ].join('\n');

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('expo.dev/graphql')) {
        const body = JSON.parse(init?.body);

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-br-header-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-br-header-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: {},
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-br-header-1',
                          logFileUrls: ['https://logs.expo.dev/br-header-test.ndjson'],
                          errors: [],
                        },
                        turtleBuild: null,
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        return { ok: true, status: 200, json: async () => ({ data: {} }) } as any;
      }

      if (url === 'https://logs.expo.dev/br-header-test.ndjson') {
        return mockByteResponse(strToU8(logContent), {
          'content-encoding': 'br',
          'content-type': 'application/x-ndjson; charset=utf-8',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-gzip', {
      workflowRunId: 'workflow-run-br-header-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('@kavi/br-header-test: package not found'),
        }),
      ]),
    );
  });
});

describe('workflow log charset decoding', () => {
  beforeEach(() => {
    mockExpoEasHarnessState.settingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-charset',
          easProjectId: 'eas-project-charset',
          name: 'Charset Logs',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/deploy.yml',
          availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };
  });

  it('decodes non-UTF-8 workflow log responses using the declared charset', async () => {
    const logContent = [
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:01:00Z',
        msg: 'npm ci',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:01:04Z',
        msg: 'error dépendance privée introuvable',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        marker: 'END_PHASE',
        result: 'fail',
        time: '2026-01-02T00:01:05Z',
        msg: 'Command failed',
      }),
    ].join('\n');

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('expo.dev/graphql')) {
        const body = JSON.parse(init?.body);

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-charset-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-charset-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: {},
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-charset-1',
                          logFileUrls: ['https://logs.expo.dev/latin1-test.ndjson'],
                          errors: [],
                        },
                        turtleBuild: null,
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        return { ok: true, status: 200, json: async () => ({ data: {} }) } as any;
      }

      if (url === 'https://logs.expo.dev/latin1-test.ndjson') {
        return mockByteResponse(latin1Bytes(logContent), {
          'content-type': 'application/x-ndjson; charset=iso-8859-1',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-charset', {
      workflowRunId: 'workflow-run-charset-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('dépendance privée introuvable'),
        }),
      ]),
    );
    expect(inspection.failureLogs?.some((entry) => entry.excerpt.includes('d�pendance'))).toBe(
      false,
    );
  });
});
