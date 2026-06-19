// ---------------------------------------------------------------------------
// Tests — Failover Chain
// ---------------------------------------------------------------------------

import {
  createFailoverState,
  buildFailoverChain,
  getNextAvailableModel,
  recordFailure,
  recordSuccess,
} from '../../src/engine/failover';
import { LlmProviderConfig } from '../../src/types/provider';

// Mock SecureStorage
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('test-key'),
  saveProviderApiKey: jest.fn().mockResolvedValue(undefined),
  deleteProviderApiKey: jest.fn().mockResolvedValue(undefined),
}));

const makeProvider = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'p1',
  name: 'Test',
  baseUrl: 'https://api.test.com',
  model: 'gpt-5.4',
  enabled: true,
  ...overrides,
});

describe('buildFailoverChain', () => {
  it('filters out disabled providers', () => {
    const providers = [
      makeProvider({ id: 'a', enabled: true }),
      makeProvider({ id: 'b', enabled: false }),
      makeProvider({ id: 'c', enabled: true }),
    ];
    const chain = buildFailoverChain(providers);
    expect(chain).toHaveLength(2);
    expect(chain.map((e) => e.providerId)).toEqual(['a', 'c']);
  });

  it('assigns incremental priorities', () => {
    const providers = [makeProvider({ id: 'a' }), makeProvider({ id: 'b' })];
    const chain = buildFailoverChain(providers);
    expect(chain[0].priority).toBe(0);
    expect(chain[1].priority).toBe(1);
  });

  it('returns empty for no enabled providers', () => {
    expect(buildFailoverChain([makeProvider({ enabled: false })])).toEqual([]);
  });

  it('preserves the active model for the active provider entry', () => {
    const providers = [
      makeProvider({
        id: 'gemini',
        model: 'gemini-3.1-pro-preview',
        availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
      }),
      makeProvider({
        id: 'gateway-gemini',
        model: 'gemini-3.1-pro-preview',
        availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
      }),
    ];

    const chain = buildFailoverChain(providers, {
      providerId: 'gemini',
      model: 'gemini-3-flash-preview',
    });

    expect(chain).toEqual([
      { providerId: 'gemini', model: 'gemini-3-flash-preview', priority: 0 },
      { providerId: 'gateway-gemini', model: 'gemini-3-flash-preview', priority: 1 },
    ]);
  });

  it('skips providers that do not advertise the selected active model', () => {
    const providers = [
      makeProvider({
        id: 'gemini',
        model: 'gemini-3.1-pro-preview',
        availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
      }),
      makeProvider({
        id: 'openrouter',
        model: 'google/gemini-3.1-pro-preview',
        availableModels: ['google/gemini-3.1-pro-preview'],
      }),
      makeProvider({
        id: 'openai',
        model: 'gpt-5.4',
        availableModels: ['gpt-5.4'],
      }),
    ];

    const chain = buildFailoverChain(providers, {
      providerId: 'gemini',
      model: 'gemini-3-flash-preview',
    });

    expect(chain).toEqual([{ providerId: 'gemini', model: 'gemini-3-flash-preview', priority: 0 }]);
  });
});

describe('createFailoverState', () => {
  it('sorts chain by priority', () => {
    const chain = [
      { providerId: 'c', model: 'm', priority: 2 },
      { providerId: 'a', model: 'm', priority: 0 },
      { providerId: 'b', model: 'm', priority: 1 },
    ];
    const state = createFailoverState(chain);
    expect(state.chain[0].providerId).toBe('a');
    expect(state.chain[1].providerId).toBe('b');
    expect(state.chain[2].providerId).toBe('c');
  });

  it('initializes currentIndex to 0', () => {
    const state = createFailoverState([{ providerId: 'a', model: 'm', priority: 0 }]);
    expect(state.currentIndex).toBe(0);
  });

  it('initializes empty failures map', () => {
    const state = createFailoverState([]);
    expect(state.failures.size).toBe(0);
  });

  it('starts at the active provider and model when present in the chain', () => {
    const state = createFailoverState(
      [
        { providerId: 'a', model: 'm1', priority: 0 },
        { providerId: 'b', model: 'm2', priority: 1 },
        { providerId: 'c', model: 'm3', priority: 2 },
      ],
      {
        providerId: 'b',
        model: 'm2',
      },
    );

    expect(state.currentIndex).toBe(1);
  });
});

describe('getNextAvailableModel', () => {
  it('returns first entry by default', () => {
    const state = createFailoverState([
      { providerId: 'a', model: 'm1', priority: 0 },
      { providerId: 'b', model: 'm2', priority: 1 },
    ]);
    const entry = getNextAvailableModel(state);
    expect(entry?.providerId).toBe('a');
  });

  it('skips entries in backoff', () => {
    const state = createFailoverState([
      { providerId: 'a', model: 'm1', priority: 0 },
      { providerId: 'b', model: 'm2', priority: 1 },
    ]);
    // Put 'a' in backoff
    state.failures.set('a:m1', { count: 1, lastFailure: Date.now(), backoffMs: 60000 });
    const entry = getNextAvailableModel(state);
    expect(entry?.providerId).toBe('b');
  });

  it('returns null when all in backoff', () => {
    const state = createFailoverState([{ providerId: 'a', model: 'm1', priority: 0 }]);
    state.failures.set('a:m1', { count: 1, lastFailure: Date.now(), backoffMs: 60000 });
    expect(getNextAvailableModel(state)).toBeNull();
  });

  it('returns entry past backoff period', () => {
    const state = createFailoverState([{ providerId: 'a', model: 'm1', priority: 0 }]);
    state.failures.set('a:m1', { count: 1, lastFailure: Date.now() - 70000, backoffMs: 60000 });
    expect(getNextAvailableModel(state)?.providerId).toBe('a');
  });
});

describe('recordFailure', () => {
  it('adds failure entry and advances index', () => {
    const state = createFailoverState([
      { providerId: 'a', model: 'm1', priority: 0 },
      { providerId: 'b', model: 'm2', priority: 1 },
    ]);
    recordFailure(state, 'a', 'm1');
    expect(state.failures.has('a:m1')).toBe(true);
    expect(state.currentIndex).toBe(1);
  });

  it('increases backoff exponentially', () => {
    const state = createFailoverState([
      { providerId: 'a', model: 'm', priority: 0 },
      { providerId: 'b', model: 'm', priority: 1 },
    ]);
    recordFailure(state, 'a', 'm');
    const first = state.failures.get('a:m')!.backoffMs;

    recordFailure(state, 'a', 'm');
    const second = state.failures.get('a:m')!.backoffMs;
    expect(second).toBeGreaterThan(first);
  });

  it('caps backoff at 60 seconds', () => {
    const state = createFailoverState([{ providerId: 'a', model: 'm', priority: 0 }]);
    for (let i = 0; i < 20; i++) {
      recordFailure(state, 'a', 'm');
    }
    expect(state.failures.get('a:m')!.backoffMs).toBeLessThanOrEqual(60000);
  });
});

describe('recordSuccess', () => {
  it('clears failure for provider', () => {
    const state = createFailoverState([{ providerId: 'a', model: 'm', priority: 0 }]);
    recordFailure(state, 'a', 'm');
    expect(state.failures.has('a:m')).toBe(true);
    recordSuccess(state, 'a', 'm');
    expect(state.failures.has('a:m')).toBe(false);
  });
});
