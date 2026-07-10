import type {
  ToolEffectIdentitySelector,
  ToolEffectKind,
  ToolEffectResourceSelector,
  ToolEffectResultContract,
  ToolEffectResultOutcome,
  ToolEffectState,
  ToolEffectVerificationState,
  ToolExecutionState,
} from '../../types/toolEffectReceipt';

export interface CodeOwnedToolEffectContract {
  readonly effectMode: 'none' | 'effectful';
  readonly effectKind: ToolEffectKind;
  readonly tracksExecution?: true;
  readonly result?: ToolEffectResultContract;
  readonly completion?: {
    readonly resource?: ToolEffectIdentitySelector;
    readonly sha256ArgumentPath?: readonly string[];
  };
}

function outcome(
  effectState: ToolEffectState,
  verificationState: ToolEffectVerificationState,
  effectKind?: ToolEffectKind,
  executionState?: ToolExecutionState,
): ToolEffectResultOutcome {
  return Object.freeze({
    ...(effectKind ? { effectKind } : {}),
    ...(executionState ? { executionState } : {}),
    effectState,
    verificationState,
  });
}

function executionOutcome(executionState: ToolExecutionState): ToolEffectResultOutcome {
  return outcome('unknown', 'unverified', undefined, executionState);
}

const APPLIED = outcome('applied', 'acknowledged');
const VERIFIED = outcome('applied', 'verified');
const HANDED_OFF = outcome('handed_off', 'unverified');
const CANCELLED = outcome('cancelled', 'unverified');
const FAILED = outcome('failed', 'unverified');
const UNKNOWN = outcome('unknown', 'unverified');
const NO_EFFECT = outcome('none', 'not_applicable');

const NATIVE_NON_SUCCESS_OUTCOMES: Readonly<Record<string, ToolEffectResultOutcome>> =
  Object.freeze({
    cancelled: CANCELLED,
    unknown: UNKNOWN,
    failed: UNKNOWN,
    unavailable: FAILED,
    permission_denied: FAILED,
    permission_blocked: FAILED,
    not_found: FAILED,
  });

function selector(
  kind: string,
  source: ToolEffectIdentitySelector['source'],
  path: readonly string[],
): ToolEffectIdentitySelector {
  return Object.freeze({ kind, source, path: Object.freeze([...path]) });
}

function resourceSelector(
  kind: string,
  source: ToolEffectResourceSelector['source'],
  path: readonly string[],
  digestPath?: readonly string[],
): ToolEffectResourceSelector {
  return Object.freeze({
    kind,
    source,
    path: Object.freeze([...path]),
    ...(digestPath ? { digestPath: Object.freeze([...digestPath]) } : {}),
  });
}

function readOnly(): CodeOwnedToolEffectContract {
  return Object.freeze({ effectMode: 'none', effectKind: 'observation.read' });
}

function effectful(
  effectKind: ToolEffectKind,
  outcomes: Readonly<Record<string, ToolEffectResultOutcome>>,
  options: {
    statusPath?: readonly string[];
    resource?: ToolEffectResourceSelector;
    operationHandle?: ToolEffectIdentitySelector;
    tracksExecution?: boolean;
    completion?: CodeOwnedToolEffectContract['completion'];
  } = {},
): CodeOwnedToolEffectContract {
  return Object.freeze({
    effectMode: 'effectful',
    effectKind,
    ...(options.tracksExecution ? { tracksExecution: true as const } : {}),
    ...(options.completion
      ? {
          completion: Object.freeze({
            ...(options.completion.resource
              ? { resource: options.completion.resource }
              : {}),
            ...(options.completion.sha256ArgumentPath
              ? {
                  sha256ArgumentPath: Object.freeze([
                    ...options.completion.sha256ArgumentPath,
                  ]),
                }
              : {}),
          }),
        }
      : {}),
    result: Object.freeze({
      statusPath: Object.freeze([...(options.statusPath ?? ['status'])]),
      outcomes: Object.freeze({ ...outcomes }),
      ...(options.resource ? { resource: options.resource } : {}),
      ...(options.operationHandle ? { operationHandle: options.operationHandle } : {}),
    }),
  });
}

function nativeOutcomes(
  outcomes: Readonly<Record<string, ToolEffectResultOutcome>>,
): Readonly<Record<string, ToolEffectResultOutcome>> {
  return Object.freeze({ ...NATIVE_NON_SUCCESS_OUTCOMES, ...outcomes });
}

const READ_ONLY_NATIVE_TOOLS = [
  'calendar_list',
  'calendar_events',
  'clipboard_read',
  'contacts_pick',
  'contacts_view',
  'contacts_search',
  'contacts_get',
  'contacts_search_full',
  'contacts_get_full',
  'device_status',
  'device_info',
  'device_permissions',
  'device_health',
  'device_query',
  'location_current',
  'photos_latest',
] as const;

const READ_ONLY_CONTRACTS = Object.fromEntries(
  READ_ONLY_NATIVE_TOOLS.map((toolName) => [toolName, readOnly()]),
) as Record<string, CodeOwnedToolEffectContract>;

// Keep this registry closed to reviewed first-party implementations. Runtime,
// MCP, and skill declarations must never be able to grant themselves evidence.
const CODE_OWNED_TOOL_EFFECT_CONTRACTS: Readonly<Record<string, CodeOwnedToolEffectContract>> =
  Object.freeze({
    // A successful interpreter exit proves execution, not the completeness or
    // verification of arbitrary side effects produced by user-authored code.
    javascript: effectful(
      'compute.execute',
      {
        completed: executionOutcome('completed'),
        effect_failed: executionOutcome('completed'),
        failed: executionOutcome('failed'),
      },
      { tracksExecution: true },
    ),
    python: effectful(
      'compute.execute',
      {
        completed: executionOutcome('completed'),
        effect_failed: executionOutcome('completed'),
        failed: executionOutcome('failed'),
        timed_out: executionOutcome('timed_out'),
      },
      { tracksExecution: true },
    ),
    // Workspace writes expose a code-computed content digest, but do not read
    // the file back; their successful result is an acknowledgement, not proof.
    write_file: effectful(
      'artifact.write',
      { written: APPLIED },
      {
        resource: resourceSelector('workspace_file', 'result', ['path'], ['sha256']),
        completion: {
          resource: selector('workspace_file', 'arguments', ['path']),
          sha256ArgumentPath: ['content'],
        },
      },
    ),
    file_edit: effectful(
      'artifact.write',
      { edited: APPLIED },
      {
        resource: resourceSelector('workspace_file', 'result', ['path'], ['sha256']),
        completion: {
          resource: selector('workspace_file', 'arguments', ['path']),
        },
      },
    ),
    // Image persistence checks file existence and exact byte count before
    // these results are emitted, so the local artifact is independently verified.
    image_generate: effectful(
      'artifact.write',
      { generated: VERIFIED },
      { resource: resourceSelector('workspace_file', 'result', ['workspacePath']) },
    ),
    image_edit: effectful(
      'artifact.write',
      { edited: VERIFIED },
      { resource: resourceSelector('workspace_file', 'result', ['workspacePath']) },
    ),
    // Canvas state changes synchronously in memory, while durable storage is
    // fire-and-forget; these results acknowledge application without verification.
    canvas_create: effectful(
      'artifact.write',
      { created: APPLIED },
      { resource: resourceSelector('canvas_surface', 'result', ['surfaceId']) },
    ),
    canvas_update: effectful(
      'artifact.write',
      { updated: APPLIED },
      { resource: resourceSelector('canvas_surface', 'result', ['surfaceId']) },
    ),
    canvas_navigate: effectful(
      'artifact.write',
      { navigated: APPLIED },
      { resource: resourceSelector('canvas_surface', 'result', ['surfaceId']) },
    ),
    canvas_delete: effectful(
      'artifact.delete',
      { deleted: APPLIED },
      { resource: resourceSelector('canvas_surface', 'result', ['surfaceId']) },
    ),
    ...READ_ONLY_CONTRACTS,
    calendar_create_event: effectful(
      'calendar.create',
      { created: APPLIED },
      { resource: selector('calendar_event', 'result', ['eventId']) },
    ),
    calendar_update_event: effectful(
      'calendar.update',
      { updated: APPLIED },
      { resource: selector('calendar_event', 'result', ['eventId']) },
    ),
    clipboard_write: effectful('clipboard.write', { written: APPLIED }),
    clipboard: effectful('clipboard.write', {
      read: outcome('none', 'not_applicable', 'observation.read'),
      written: APPLIED,
    }),
    email_compose: effectful(
      'communication.send',
      nativeOutcomes({
        sent: APPLIED,
        saved: outcome('applied', 'acknowledged', 'communication.draft_save'),
        fallback_opened: outcome('handed_off', 'unverified', 'communication.draft_handoff'),
      }),
    ),
    sms_compose: effectful('communication.send', nativeOutcomes({ sent: APPLIED })),
    phone_call: effectful('communication.call_handoff', nativeOutcomes({ opened: HANDED_OFF })),
    maps_open: effectful('navigation.open', nativeOutcomes({ opened: HANDED_OFF })),
    open_url: effectful('external.open', nativeOutcomes({ opened: HANDED_OFF })),
    contacts_manage_access: effectful(
      'contact.access_update',
      nativeOutcomes({ updated: APPLIED, unchanged: NO_EFFECT }),
    ),
    contacts_edit: effectful('contact.update', nativeOutcomes({ opened: HANDED_OFF })),
    contacts_create: effectful('contact.create', nativeOutcomes({ opened: HANDED_OFF })),
    contacts_form: effectful(
      'unknown',
      {
        contacts_view_opened: outcome('none', 'not_applicable', 'observation.read'),
        contacts_edit_opened: outcome('handed_off', 'unverified', 'contact.update'),
        contacts_create_opened: outcome('handed_off', 'unverified', 'contact.create'),
      },
      { statusPath: ['code'] },
    ),
    contacts_share: effectful('share.handoff', nativeOutcomes({ handed_off: HANDED_OFF })),
    share_contact: effectful('share.handoff', nativeOutcomes({ handed_off: HANDED_OFF })),
    share_text: effectful('share.handoff', nativeOutcomes({ handed_off: HANDED_OFF })),
    share_url: effectful('share.handoff', nativeOutcomes({ handed_off: HANDED_OFF })),
    share_file: effectful('share.handoff', nativeOutcomes({ handed_off: HANDED_OFF })),
    share: effectful('share.handoff', nativeOutcomes({ handed_off: HANDED_OFF })),
    notification_send: effectful(
      'notification.send',
      { notification_accepted: outcome('accepted', 'acknowledged') },
      {
        resource: selector('notification', 'result', ['id']),
        operationHandle: selector('notification_request', 'result', ['id']),
      },
    ),
    notification_schedule: effectful(
      'notification.schedule',
      { notification_scheduled: APPLIED },
      {
        resource: selector('notification', 'result', ['id']),
        operationHandle: selector('notification_schedule', 'result', ['id']),
      },
    ),
    notification_cancel: effectful(
      'notification.cancel',
      { notification_cancelled: APPLIED },
      { resource: selector('notification', 'result', ['id']) },
    ),
    camera_clip: effectful('media.capture', { recorded: APPLIED, cancelled: CANCELLED }),
    screen_record: effectful('media.capture', {
      captured: APPLIED,
      screenshot_not_available: FAILED,
    }),
    haptic_feedback: effectful('device.haptic', { triggered: APPLIED }),
  });

export function getCodeOwnedToolEffectContract(
  canonicalToolName: string,
): CodeOwnedToolEffectContract | undefined {
  return CODE_OWNED_TOOL_EFFECT_CONTRACTS[canonicalToolName];
}
