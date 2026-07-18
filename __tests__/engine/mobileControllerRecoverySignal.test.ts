import {
  buildMobileControllerStrategyFingerprint,
  projectMobileControllerRecoveryOutcome,
  resolveMobileControllerRecoveryPreflight,
  resolveMobileControllerRecoverySignal,
} from '../../src/engine/graph/mobileControllerRecoveryPolicy';
import type {
  AgentRunControlGraphTurnDirectives,
  AgentRunMobileControllerRecoveryState,
} from '../../src/types/agentRun';
import type { MobileControllerExecutionBinding } from '../../src/engine/mobileController/runtimeBinding';
import { createMobileControllerCapabilityFixture } from '../helpers/mobileControllerHandoffFixture';

const binding: MobileControllerExecutionBinding = {
  capability: createMobileControllerCapabilityFixture({
    supportedActionKinds: ['activate', 'back', 'input_text', 'wait'],
  }),
  currentObservation: {
    observationId: 'observation-1',
    digest: `sha256:${'a'.repeat(64)}`,
    appId: 'com.example.notes',
    windowId: 'main',
  },
};

function directives(
  mobileControllerRecovery?: AgentRunMobileControllerRecoveryState,
  automaticRecoveryAttemptCount = 0,
): AgentRunControlGraphTurnDirectives {
  return {
    forceFinalText: false,
    requireWorkflowTool: false,
    incompleteFinalTextRecoveryCount: 0,
    ...(automaticRecoveryAttemptCount > 0 ? { automaticRecoveryAttemptCount } : {}),
    ...(mobileControllerRecovery ? { mobileControllerRecovery } : {}),
  };
}

function call(id: string, action: Record<string, unknown>) {
  return {
    id,
    name: 'mobile_ui_action',
    arguments: JSON.stringify(action),
  };
}

function outcome(observableDelta: 'changed' | 'unchanged'): string {
  return JSON.stringify({
    version: 1,
    executionState: 'completed',
    effectState: 'applied',
    verificationState: 'acknowledged',
    observableDelta,
  });
}

function advanceStall(
  state: AgentRunMobileControllerRecoveryState | undefined,
  sequence: number,
): AgentRunMobileControllerRecoveryState {
  const toolCall = call(`call-${sequence}`, {
    kind: 'activate',
    target: {
      kind: 'coordinate',
      observationId: binding.currentObservation.observationId,
      x: 120,
      y: 220,
    },
  });
  const preflight = resolveMobileControllerRecoveryPreflight({
    toolCall,
    binding,
    directives: directives(state),
  });
  if (preflight.kind !== 'allow' || !preflight.directives.mobileControllerRecovery) {
    throw new Error('expected tracked mobile action');
  }
  const projected = projectMobileControllerRecoveryOutcome({
    state: preflight.directives.mobileControllerRecovery,
    toolCallId: toolCall.id,
    content: outcome('unchanged'),
  });
  if (projected.kind !== 'replace') throw new Error('expected tracked stall');
  return projected.state;
}

describe('mobile controller recovery policy', () => {
  it('normalizes coordinate jitter into the same content-free strategy', () => {
    const action = (x: number) => ({
      kind: 'activate' as const,
      target: {
        kind: 'coordinate' as const,
        observationId: binding.currentObservation.observationId,
        x,
        y: 220,
      },
    });

    expect(buildMobileControllerStrategyFingerprint({ action: action(100), binding })).toBe(
      buildMobileControllerStrategyFingerprint({ action: action(124), binding }),
    );
    expect(buildMobileControllerStrategyFingerprint({ action: action(100), binding })).not.toBe(
      buildMobileControllerStrategyFingerprint({ action: action(151), binding }),
    );
  });

  it('rejects an equivalent fourth dispatch and consumes one recovery attempt', () => {
    let state: AgentRunMobileControllerRecoveryState | undefined;
    state = advanceStall(state, 1);
    state = advanceStall(state, 2);
    state = advanceStall(state, 3);

    expect(resolveMobileControllerRecoverySignal(state)).toEqual(
      expect.objectContaining({
        version: 1,
        consecutiveStalls: 3,
        requiredResponse: 'change_strategy_or_report_blocker',
      }),
    );

    const decision = resolveMobileControllerRecoveryPreflight({
      toolCall: call('call-4', {
        kind: 'activate',
        target: {
          kind: 'coordinate',
          observationId: binding.currentObservation.observationId,
          x: 121,
          y: 221,
        },
      }),
      binding,
      directives: directives(state),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        kind: 'block',
        closesRecovery: false,
        directives: expect.objectContaining({
          automaticRecoveryAttemptCount: 1,
          mobileControllerRecovery: expect.objectContaining({
            phase: 'strategy_change_required',
          }),
        }),
      }),
    );
    if (decision.kind !== 'block') throw new Error('expected blocked repeated strategy');
    expect(decision.blocker).toContain('equivalent_strategy_stalled');
  });

  it('allows one materially different recovery and clears pressure after progress', () => {
    let state: AgentRunMobileControllerRecoveryState | undefined;
    state = advanceStall(state, 1);
    state = advanceStall(state, 2);
    state = advanceStall(state, 3);
    const blocked = resolveMobileControllerRecoveryPreflight({
      toolCall: call('call-4', {
        kind: 'activate',
        target: {
          kind: 'coordinate',
          observationId: binding.currentObservation.observationId,
          x: 120,
          y: 220,
        },
      }),
      binding,
      directives: directives(state),
    });
    if (blocked.kind !== 'block' || !blocked.directives.mobileControllerRecovery) {
      throw new Error('expected strategy-change boundary');
    }

    const alternative = resolveMobileControllerRecoveryPreflight({
      toolCall: call('call-5', { kind: 'back' }),
      binding,
      directives: directives(blocked.directives.mobileControllerRecovery, 1),
    });
    expect(alternative).toEqual(
      expect.objectContaining({
        kind: 'allow',
        directives: expect.objectContaining({
          mobileControllerRecovery: expect.objectContaining({ phase: 'recovery_in_flight' }),
        }),
      }),
    );
    if (alternative.kind !== 'allow' || !alternative.directives.mobileControllerRecovery) {
      throw new Error('expected alternative recovery');
    }
    expect(
      projectMobileControllerRecoveryOutcome({
        state: alternative.directives.mobileControllerRecovery,
        toolCallId: 'call-5',
        content: outcome('changed'),
      }),
    ).toEqual({ kind: 'clear' });
  });

  it('closes safely when the materially different recovery also stalls', () => {
    const recoveryState: AgentRunMobileControllerRecoveryState = {
      version: 1,
      phase: 'recovery_in_flight',
      strategyFingerprint: `sha256:${'b'.repeat(64)}`,
      blockedStrategyFingerprint: `sha256:${'c'.repeat(64)}`,
      toolCallId: 'alternative-call',
    };
    const projection = projectMobileControllerRecoveryOutcome({
      state: recoveryState,
      toolCallId: 'alternative-call',
      content: outcome('unchanged'),
    });
    if (projection.kind !== 'replace') throw new Error('expected stalled recovery');

    const decision = resolveMobileControllerRecoveryPreflight({
      toolCall: call('another-call', { kind: 'back' }),
      binding,
      directives: directives(projection.state, 1),
    });
    expect(decision).toEqual(
      expect.objectContaining({
        kind: 'block',
        closesRecovery: true,
        directives: expect.objectContaining({
          forceFinalText: true,
          forcedTextReason: 'execution_loop_recovery',
        }),
      }),
    );
  });

  it('does not turn waits or uncertain outcomes into no-progress retries', () => {
    expect(
      resolveMobileControllerRecoveryPreflight({
        toolCall: call('wait-call', { kind: 'wait', durationMs: 500 }),
        binding,
        directives: directives(),
      }),
    ).toEqual({ kind: 'not_applicable' });

    const tracked = resolveMobileControllerRecoveryPreflight({
      toolCall: call('action-call', { kind: 'back' }),
      binding,
      directives: directives(),
    });
    if (tracked.kind !== 'allow' || !tracked.directives.mobileControllerRecovery) {
      throw new Error('expected tracked action');
    }
    const uncertain = projectMobileControllerRecoveryOutcome({
      state: tracked.directives.mobileControllerRecovery,
      toolCallId: 'action-call',
      content: JSON.stringify({
        version: 1,
        executionState: 'unknown',
        effectState: 'unknown',
        verificationState: 'unverified',
        observableDelta: 'unknown',
      }),
    });
    expect(uncertain).toEqual(
      expect.objectContaining({
        kind: 'replace',
        state: expect.objectContaining({ phase: 'outcome_uncertain' }),
      }),
    );
  });
});
