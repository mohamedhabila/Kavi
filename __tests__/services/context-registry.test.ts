// ---------------------------------------------------------------------------
// Context Engine Registry — tests
// ---------------------------------------------------------------------------

import {
  registerContextEngine,
  getContextEngineFactory,
  listContextEngineIds,
  resolveContextEngine,
} from '../../src/services/context/registry';

describe('Context Engine Registry', () => {
  // Clean up registry between tests
  beforeEach(() => {
    // Registry uses globalThis symbol, clear it
    const key = Symbol.for('kavi.contextEngineRegistry');
    const g = globalThis as any;
    if (g[key]) {
      g[key].engines.clear();
    }
  });

  it('should register and retrieve a factory', () => {
    const factory = jest.fn(() => ({
      name: 'test',
      bootstrap: jest.fn(),
      ingest: jest.fn(),
      assemble: jest.fn(),
      compact: jest.fn(),
    }));
    registerContextEngine('test', factory);
    expect(getContextEngineFactory('test')).toBe(factory);
  });

  it('should return undefined for non-existent engine', () => {
    expect(getContextEngineFactory('nope')).toBeUndefined();
  });

  it('should list registered engine IDs', () => {
    registerContextEngine('a', jest.fn());
    registerContextEngine('b', jest.fn());
    const ids = listContextEngineIds();
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('should resolve a registered engine', async () => {
    const mockEngine = {
      name: 'default',
      bootstrap: jest.fn(),
      ingest: jest.fn(),
      assemble: jest.fn(),
      compact: jest.fn(),
    };
    registerContextEngine('default', () => mockEngine);
    const engine = await resolveContextEngine('default');
    expect(engine).toBe(mockEngine);
  });

  it('should resolve async engine factory', async () => {
    const mockEngine = {
      name: 'async',
      bootstrap: jest.fn(),
      ingest: jest.fn(),
      assemble: jest.fn(),
      compact: jest.fn(),
    };
    registerContextEngine('async', async () => mockEngine);
    const engine = await resolveContextEngine('async');
    expect(engine).toBe(mockEngine);
  });

  it('should use "default" engine when no id specified', async () => {
    const mockEngine = {
      name: 'default',
      bootstrap: jest.fn(),
      ingest: jest.fn(),
      assemble: jest.fn(),
      compact: jest.fn(),
    };
    registerContextEngine('default', () => mockEngine);
    const engine = await resolveContextEngine();
    expect(engine).toBe(mockEngine);
  });

  it('should throw if engine not found', async () => {
    await expect(resolveContextEngine('missing')).rejects.toThrow('not registered');
  });

  it('should list available engines in error message', async () => {
    registerContextEngine('foo', jest.fn());
    registerContextEngine('bar', jest.fn());
    await expect(resolveContextEngine('missing')).rejects.toThrow('foo');
  });

  it('should overwrite engine with same id', () => {
    const f1 = jest.fn();
    const f2 = jest.fn();
    registerContextEngine('same', f1);
    registerContextEngine('same', f2);
    expect(getContextEngineFactory('same')).toBe(f2);
  });
});
