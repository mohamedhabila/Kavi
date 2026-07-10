import {
  initializeDurableRecoveryLifecycle,
  reconcileDurableRecoveryLifecycle,
  scheduleDurableRecoveryRunImmediately,
  type DurableRecoveryLifecycleDependencies,
} from '../../src/services/executionJournal/durableRecoveryLifecycle';

function dependencies(platform: string): DurableRecoveryLifecycleDependencies {
  return {
    platform,
    scheduleAndroid: jest.fn(async (runId) => ({ kind: 'scheduled', runId })),
    scheduleIOS: jest.fn(async (runId) => ({ kind: 'already_scheduled', runId })),
    repairAndroid: jest.fn(),
    initializeIOS: jest.fn(),
    reconcileIOS: jest.fn(),
  };
}

describe('durable recovery lifecycle routing', () => {
  it('schedules the exact generation through Android only', async () => {
    const deps = dependencies('android');

    await expect(scheduleDurableRecoveryRunImmediately('run-1', deps)).resolves.toEqual({
      kind: 'scheduled',
      runId: 'run-1',
    });

    expect(deps.scheduleAndroid).toHaveBeenCalledWith('run-1');
    expect(deps.scheduleIOS).not.toHaveBeenCalled();
  });

  it('schedules the exact generation through iOS only', async () => {
    const deps = dependencies('ios');

    await expect(scheduleDurableRecoveryRunImmediately('run-1', deps)).resolves.toEqual({
      kind: 'already_scheduled',
      runId: 'run-1',
    });

    expect(deps.scheduleIOS).toHaveBeenCalledWith('run-1');
    expect(deps.scheduleAndroid).not.toHaveBeenCalled();
  });

  it('closes unsupported scheduling without touching a native implementation', async () => {
    const deps = dependencies('web');

    await expect(scheduleDurableRecoveryRunImmediately('run-1', deps)).resolves.toEqual({
      kind: 'not_supported',
      runId: 'run-1',
      reason: 'unsupported_platform',
    });

    expect(deps.scheduleAndroid).not.toHaveBeenCalled();
    expect(deps.scheduleIOS).not.toHaveBeenCalled();
  });

  it('routes startup ownership to one platform implementation', () => {
    const android = dependencies('android');
    const ios = dependencies('ios');
    const unsupported = dependencies('web');

    initializeDurableRecoveryLifecycle(android);
    initializeDurableRecoveryLifecycle(ios);
    initializeDurableRecoveryLifecycle(unsupported);

    expect(android.repairAndroid).toHaveBeenCalledWith('startup');
    expect(android.initializeIOS).not.toHaveBeenCalled();
    expect(ios.initializeIOS).toHaveBeenCalledTimes(1);
    expect(ios.repairAndroid).not.toHaveBeenCalled();
    expect(unsupported.repairAndroid).not.toHaveBeenCalled();
    expect(unsupported.initializeIOS).not.toHaveBeenCalled();
  });

  it('routes foreground repair to one platform implementation', () => {
    const android = dependencies('android');
    const ios = dependencies('ios');
    const unsupported = dependencies('web');

    reconcileDurableRecoveryLifecycle('foreground', android);
    reconcileDurableRecoveryLifecycle('foreground', ios);
    reconcileDurableRecoveryLifecycle('foreground', unsupported);

    expect(android.repairAndroid).toHaveBeenCalledWith('foreground');
    expect(android.reconcileIOS).not.toHaveBeenCalled();
    expect(ios.reconcileIOS).toHaveBeenCalledWith('foreground');
    expect(ios.repairAndroid).not.toHaveBeenCalled();
    expect(unsupported.repairAndroid).not.toHaveBeenCalled();
    expect(unsupported.reconcileIOS).not.toHaveBeenCalled();
  });
});
