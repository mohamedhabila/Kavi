import { createLogger } from '../../src/utils/logger';

const runtimeGlobal = globalThis as typeof globalThis & {
  jest?: unknown;
  __DEV__?: boolean;
};

const originalJest = runtimeGlobal.jest;
const originalDev = runtimeGlobal.__DEV__;
const originalJestWorkerId = process.env.JEST_WORKER_ID;

describe('logger utils', () => {
  afterEach(() => {
    runtimeGlobal.jest = originalJest;
    runtimeGlobal.__DEV__ = originalDev;
    if (originalJestWorkerId === undefined) {
      delete process.env.JEST_WORKER_ID;
    } else {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    }
    jest.restoreAllMocks();
  });

  it('suppresses dev-only logs in the Jest runtime', () => {
    runtimeGlobal.jest = {};
    runtimeGlobal.__DEV__ = true;
    process.env.JEST_WORKER_ID = '1';
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger('TestLogger');

    logger.debug('hidden debug');
    logger.devWarn('hidden warn');
    logger.devLog('hidden log');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('emits scoped dev-only logs outside Jest', () => {
    runtimeGlobal.jest = undefined;
    runtimeGlobal.__DEV__ = true;
    delete process.env.JEST_WORKER_ID;
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger('TestLogger');

    logger.debug('debug message');
    logger.devWarn('warn message', { cause: 'test' });
    logger.devLog('log message');

    expect(debugSpy).toHaveBeenCalledWith('[TestLogger] debug message');
    expect(warnSpy).toHaveBeenCalledWith('[TestLogger] warn message', { cause: 'test' });
    expect(logSpy).toHaveBeenCalledWith('[TestLogger] log message');
  });

  it('keeps non-dev warnings enabled', () => {
    runtimeGlobal.jest = {};
    runtimeGlobal.__DEV__ = false;
    process.env.JEST_WORKER_ID = '1';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createLogger('TestLogger');

    logger.warn('always on');

    expect(warnSpy).toHaveBeenCalledWith('[TestLogger] always on');
  });
});
