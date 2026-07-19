import type { LlmProviderConfig } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';
import type {
  MobileControllerAction,
  MobileControllerCapability,
  MobileControllerObservationRef,
} from './contracts';
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
  /** Code-owned policy review. Required outside sandbox environments. */
  reviewAction?: (
    input: Readonly<{
      action: MobileControllerAction;
      currentObservation: MobileControllerObservationRef;
    }>,
  ) => MobileControllerActionReview | Promise<MobileControllerActionReview>;
  publishHandoff(handoff: MobileControllerPublishedHandoff): void | Promise<void>;
}

export interface MobileControllerRuntimePort extends MobileControllerHostPort {
  persistGraphState(): Promise<void>;
}

export type MobileControllerExecutionBinding = Readonly<{
  capability: MobileControllerCapability;
  currentObservation: MobileControllerObservationRef;
  reviewAction?: NonNullable<MobileControllerHostPort['reviewAction']>;
}>;

export type MobileControllerActionReview =
  | Readonly<{ kind: 'allow' }>
  | Readonly<{
      kind: 'confirm' | 'takeover';
      title: string;
      description: string;
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
        | 'action_review_unsupported'
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
  if (capability.environmentClass !== 'sandbox' && typeof port.reviewAction !== 'function') {
    return Object.freeze({ kind: 'rejected', reason: 'action_review_unsupported' });
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
      execution: Object.freeze({
        capability,
        currentObservation,
        ...(capability.environmentClass !== 'sandbox' && typeof port.reviewAction === 'function'
          ? { reviewAction: port.reviewAction.bind(input.port) }
          : {}),
      }),
      persistGraphState: port.persistGraphState.bind(input.port),
      publishHandoff: port.publishHandoff.bind(input.port),
      toolDefinition,
    }),
  });
}

const REVIEW_CONTROL_CHARACTER_PATTERN = /\p{C}/u;

function reviewText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  return value === normalized &&
    normalized.length > 0 &&
    Array.from(normalized).length <= maximumLength &&
    !REVIEW_CONTROL_CHARACTER_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function qualifyMobileControllerActionReview(
  candidate: unknown,
): MobileControllerActionReview | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const prototype = Object.getPrototypeOf(candidate);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const record = candidate as Record<string, unknown>;
  if (record.kind === 'allow') {
    return Object.keys(record).length === 1 ? Object.freeze({ kind: 'allow' }) : null;
  }
  if (record.kind !== 'confirm' && record.kind !== 'takeover') return null;
  if (Object.keys(record).sort().join(',') !== 'description,kind,title') return null;
  const title = reviewText(record.title, 120);
  const description = reviewText(record.description, 500);
  return title && description
    ? Object.freeze({ kind: record.kind, title, description })
    : null;
}
