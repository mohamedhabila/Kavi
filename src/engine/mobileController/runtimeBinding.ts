import type { LlmProviderConfig } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';
import type { MobileControllerCapability, MobileControllerObservationRef } from './contracts';
import type { MobileControllerPublishedHandoff } from './publication';
import type { Attachment } from '../../types/attachment';
import { buildMobileControllerToolDefinition } from './toolDefinition';
import { qualifyMobileControllerObservationImage } from './observationImage';
import {
  qualifyMobileControllerCapability,
  qualifyMobileControllerObservationRef,
} from './validation';

export interface MobileControllerHostPort {
  capability: MobileControllerCapability;
  currentObservation: MobileControllerObservationRef;
  /** Ephemeral visual evidence for this turn; never journaled or stored in chat. */
  currentObservationImage?: Attachment;
  publishHandoff(handoff: MobileControllerPublishedHandoff): void | Promise<void>;
}

export interface MobileControllerRuntimePort extends MobileControllerHostPort {
  persistGraphState(): Promise<void>;
}

export type MobileControllerExecutionBinding = Readonly<{
  capability: MobileControllerCapability;
  currentObservation: MobileControllerObservationRef;
}>;

export type AdmittedMobileControllerRuntime = Readonly<{
  execution: MobileControllerExecutionBinding;
  persistGraphState: MobileControllerRuntimePort['persistGraphState'];
  publishHandoff: MobileControllerRuntimePort['publishHandoff'];
  toolDefinition: ToolDefinition;
}>;

export type MobileControllerRuntimeAdmission =
  | Readonly<{ kind: 'admitted'; runtime: AdmittedMobileControllerRuntime }>
  | Readonly<{
      kind: 'rejected';
      reason:
        | 'port_invalid'
        | 'deferred_outcome_unsupported'
        | 'model_tools_unsupported'
        | 'model_vision_unsupported';
    }>;

export function admitMobileControllerRuntime(input: {
  port: unknown;
  provider: LlmProviderConfig;
  model: string;
}): MobileControllerRuntimeAdmission {
  const port = input.port as Partial<MobileControllerRuntimePort> | null;
  const capability = qualifyMobileControllerCapability(port?.capability);
  const currentObservation = qualifyMobileControllerObservationRef(port?.currentObservation);
  const observationImage =
    port?.currentObservationImage === undefined
      ? undefined
      : qualifyMobileControllerObservationImage(port.currentObservationImage);
  if (
    !port ||
    !capability ||
    !currentObservation ||
    (port.currentObservationImage !== undefined && !observationImage) ||
    typeof port.publishHandoff !== 'function' ||
    typeof port.persistGraphState !== 'function'
  ) {
    return Object.freeze({ kind: 'rejected', reason: 'port_invalid' });
  }
  if (!capability.outcomeDeliveryModes.includes('deferred')) {
    return Object.freeze({ kind: 'rejected', reason: 'deferred_outcome_unsupported' });
  }
  const modelCapabilities = input.provider.modelCapabilities?.[input.model];
  if (modelCapabilities?.tools !== true) {
    return Object.freeze({ kind: 'rejected', reason: 'model_tools_unsupported' });
  }
  if (modelCapabilities.vision !== true) {
    return Object.freeze({ kind: 'rejected', reason: 'model_vision_unsupported' });
  }
  const toolDefinition = buildMobileControllerToolDefinition(capability);
  if (!toolDefinition) {
    return Object.freeze({ kind: 'rejected', reason: 'port_invalid' });
  }
  return Object.freeze({
    kind: 'admitted',
    runtime: Object.freeze({
      execution: Object.freeze({ capability, currentObservation }),
      persistGraphState: port.persistGraphState.bind(input.port),
      publishHandoff: port.publishHandoff.bind(input.port),
      toolDefinition,
    }),
  });
}
