import {
  abortAllScheduledJobExecutions,
  getScheduledExecutionLifecycleEpoch,
  registerScheduledJobExecution,
  resetScheduledExecutionLifecycleForTests,
  type ScheduledJobExecutionRegistration,
} from '../../src/services/scheduler/executionLifecycle';

describe('scheduled execution lifecycle', () => {
  const registrations: ScheduledJobExecutionRegistration[] = [];
  const register = (jobId: string) => {
    const registration = registerScheduledJobExecution(
      jobId,
      getScheduledExecutionLifecycleEpoch(),
    );
    registrations.push(registration);
    return registration;
  };

  afterEach(() => {
    for (const registration of registrations.splice(0)) registration.unregister();
    expect(abortAllScheduledJobExecutions()).toBe(0);
    resetScheduledExecutionLifecycleForTests();
  });

  it('registers and aborts every active execution, including duplicate job ids', () => {
    const first = register('job-1');
    const second = register('job-1');

    expect(abortAllScheduledJobExecutions()).toBe(2);
    expect(first.controller.signal).toMatchObject({ aborted: true });
    expect(second.controller.signal).toMatchObject({ aborted: true });
    expect(first.controller.signal.reason).toMatchObject({ name: 'AbortError' });
    expect(abortAllScheduledJobExecutions()).toBe(0);
  });

  it('unregisters idempotently without aborting unrelated executions', () => {
    const completed = register('job-1');
    const active = register('job-2');

    completed.unregister();
    completed.unregister();

    expect(abortAllScheduledJobExecutions()).toBe(1);
    expect(completed.controller.signal.aborted).toBe(false);
    expect(active.controller.signal.aborted).toBe(true);
  });

  it('rejects a late registration from the epoch that entered the background', () => {
    const staleEpoch = getScheduledExecutionLifecycleEpoch();
    expect(abortAllScheduledJobExecutions()).toBe(0);

    const registration = registerScheduledJobExecution('job-late', staleEpoch);
    registrations.push(registration);

    expect(registration.controller.signal.aborted).toBe(true);
    expect(() => registration.throwIfBackgrounded()).toThrow(
      'Scheduled task execution stopped because the app entered the background',
    );
  });
});
