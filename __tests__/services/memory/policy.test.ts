type SettingsState = { disableLongTermMemory: boolean };

function loadPolicy(initialState: SettingsState, subscribeAvailable = true) {
  let state = initialState;
  let listener: ((next: SettingsState, previous: SettingsState) => void) | null = null;
  const unsubscribe = jest.fn();
  const subscribe = jest.fn((nextListener) => {
    listener = nextListener;
    return unsubscribe;
  });
  const store = {
    getState: jest.fn(() => state),
    ...(subscribeAvailable ? { subscribe } : {}),
  };

  jest.resetModules();
  jest.doMock('../../../src/store/useSettingsStore', () => ({
    useSettingsStore: store,
  }));
  let policy!: typeof import('../../../src/services/memory/policy');
  jest.isolateModules(() => {
    policy = require('../../../src/services/memory/policy');
  });

  return {
    policy,
    subscribe,
    setDisabled(disabled: boolean) {
      const previous = state;
      state = { disableLongTermMemory: disabled };
      listener?.(state, previous);
    },
    failReads() {
      store.getState.mockImplementation(() => {
        throw new Error('settings unavailable');
      });
    },
  };
}

describe('memory policy observation', () => {
  afterEach(() => {
    jest.dontMock('../../../src/store/useSettingsStore');
    jest.resetModules();
  });

  it('starts explicitly and invalidates in-flight work on the opt-out edge', () => {
    const harness = loadPolicy({ disableLongTermMemory: false });
    const handler = jest.fn();
    harness.policy.registerMemoryOptOutHandler(handler);
    const initialEpoch = harness.policy.getMemoryPolicyEpoch();

    expect(harness.policy.initializeMemoryPolicyObservation()).toBe(true);
    expect(harness.policy.initializeMemoryPolicyObservation()).toBe(true);
    expect(harness.subscribe).toHaveBeenCalledTimes(1);

    harness.setDisabled(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(harness.policy.getMemoryPolicyEpoch()).toBe(initialEpoch + 1);
    expect(harness.policy.canReadLongTermMemory()).toBe(false);

    harness.setDisabled(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('invalidates immediately when startup finds memory already disabled', () => {
    const harness = loadPolicy({ disableLongTermMemory: true });
    const handler = jest.fn();
    harness.policy.registerMemoryOptOutHandler(handler);

    expect(harness.policy.initializeMemoryPolicyObservation()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(harness.policy.canWriteLongTermMemory()).toBe(false);
  });

  it('fails closed when settings reads or observation are unavailable', () => {
    const unreadable = loadPolicy({ disableLongTermMemory: false });
    unreadable.failReads();
    expect(unreadable.policy.canUseNetworkMemoryProvider()).toBe(false);

    const unobservable = loadPolicy({ disableLongTermMemory: false }, false);
    const handler = jest.fn();
    unobservable.policy.registerMemoryOptOutHandler(handler);
    expect(unobservable.policy.initializeMemoryPolicyObservation()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(unobservable.policy.canReadLongTermMemory()).toBe(false);
  });

  it('runs every opt-out handler even when one throws', () => {
    const harness = loadPolicy({ disableLongTermMemory: false });
    const second = jest.fn();
    harness.policy.registerMemoryOptOutHandler(() => {
      throw new Error('cleanup failed');
    });
    harness.policy.registerMemoryOptOutHandler(second);
    harness.policy.initializeMemoryPolicyObservation();

    expect(() => harness.setDisabled(true)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
