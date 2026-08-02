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
import { CODE_OWNED_EFFECT_FREE_SERVICE_TOOL_NAMES } from '../../services/integrations/codeOwnedServiceTools';
import type { ToolEffectResultCondition } from './toolEffectResultConditions';

export interface CodeOwnedToolEffectContract {
  readonly effectMode: 'none' | 'effectful';
  readonly effectKind: ToolEffectKind;
  readonly completionMode?: 'operational';
  readonly receiptSettlementMode?: 'returned_unverified' | 'acknowledged_returned_unverified';
  readonly tracksExecution?: true;
  readonly result?: ToolEffectResultContract;
  readonly completion?: {
    readonly resource?: ToolEffectIdentitySelector;
    readonly sha256ArgumentPath?: readonly string[];
    readonly executionEffectFreeWhen?: {
      readonly resultPath: readonly string[];
      readonly values: readonly string[];
    };
    readonly executionEffectAcknowledgedWhen?: readonly ToolEffectResultCondition[];
    readonly effectFreeWhen?: {
      readonly argumentPath: readonly string[];
      readonly values: readonly string[];
    };
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
const VERIFIED_HANDOFF = outcome('applied', 'verified');
const CANCELLED = outcome('cancelled', 'unverified');
const FAILED = outcome('failed', 'unverified');
const UNKNOWN = outcome('unknown', 'unverified');
const NO_EFFECT = outcome('none', 'not_applicable');

const NATIVE_NON_SUCCESS_OUTCOMES: Readonly<Record<string, ToolEffectResultOutcome>> =
  Object.freeze({
    cancelled: CANCELLED,
    unknown: UNKNOWN,
    failed: UNKNOWN,
    invalid_request: FAILED,
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
            ...(options.completion.resource ? { resource: options.completion.resource } : {}),
            ...(options.completion.sha256ArgumentPath
              ? {
                  sha256ArgumentPath: Object.freeze([...options.completion.sha256ArgumentPath]),
                }
              : {}),
            ...(options.completion.executionEffectFreeWhen
              ? {
                  executionEffectFreeWhen: Object.freeze({
                    resultPath: Object.freeze([
                      ...options.completion.executionEffectFreeWhen.resultPath,
                    ]),
                    values: Object.freeze([...options.completion.executionEffectFreeWhen.values]),
                  }),
                }
              : {}),
            ...(options.completion.executionEffectAcknowledgedWhen
              ? {
                  executionEffectAcknowledgedWhen: Object.freeze(
                    options.completion.executionEffectAcknowledgedWhen.map((condition) =>
                      Object.freeze({
                        resultPath: Object.freeze([...condition.resultPath]),
                        values: Object.freeze([...condition.values]),
                      }),
                    ),
                  ),
                }
              : {}),
            ...(options.completion.effectFreeWhen
              ? {
                  effectFreeWhen: Object.freeze({
                    argumentPath: Object.freeze([
                      ...options.completion.effectFreeWhen.argumentPath,
                    ]),
                    values: Object.freeze([...options.completion.effectFreeWhen.values]),
                  }),
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

function operational(effectKind: ToolEffectKind): CodeOwnedToolEffectContract {
  return Object.freeze({ effectMode: 'effectful', effectKind, completionMode: 'operational' });
}

function returnedOperational(effectKind: ToolEffectKind): CodeOwnedToolEffectContract {
  return Object.freeze({
    ...operational(effectKind),
    receiptSettlementMode: 'returned_unverified',
  });
}

function trackedOperational(effectKind: ToolEffectKind): CodeOwnedToolEffectContract {
  return Object.freeze({
    effectMode: 'effectful',
    effectKind,
    completionMode: 'operational',
    tracksExecution: true,
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
  'photos_pick',
  ...CODE_OWNED_EFFECT_FREE_SERVICE_TOOL_NAMES,
] as const;

const READ_ONLY_CONTRACTS = Object.fromEntries(
  READ_ONLY_NATIVE_TOOLS.map((toolName) => [toolName, readOnly()]),
) as Record<string, CodeOwnedToolEffectContract>;

// Keep this registry closed to reviewed first-party implementations. Runtime,
// MCP, and skill declarations must never be able to grant themselves evidence.
const CODE_OWNED_TOOL_EFFECT_CONTRACTS: Readonly<Record<string, CodeOwnedToolEffectContract>> =
  Object.freeze({
    // JavaScript has no network or native bridge access. A successful run with
    // no observed workspace mutation therefore verifies the requested compute
    // execution. A code-owned acknowledgement can settle a persisted workspace
    // change without claiming that its contents satisfy the user's goal.
    javascript: Object.freeze({
      ...effectful(
        'compute.execute',
        {
          completed: executionOutcome('completed'),
          effect_failed: executionOutcome('completed'),
          failed: executionOutcome('failed'),
        },
        {
          tracksExecution: true,
          completion: {
            executionEffectFreeWhen: {
              resultPath: ['workspaceMutationState'],
              values: ['none_observed'],
            },
            executionEffectAcknowledgedWhen: [
              {
                resultPath: ['workspaceMutationState'],
                values: ['applied'],
              },
            ],
          },
        },
      ),
      completionMode: 'operational' as const,
      receiptSettlementMode: 'acknowledged_returned_unverified' as const,
    }),
    // Python blocks worker network primitives unless the invocation explicitly
    // enables network access. The runtime may therefore verify a successful
    // computation with no observed workspace mutation and no mutation-capable
    // HTTP method. A completed local workspace change is acknowledged only
    // when the code-owned runtime also observed no network mutation; its
    // contents remain unverified until a later readback.
    python: Object.freeze({
      ...effectful(
        'compute.execute',
        {
          completed: executionOutcome('completed'),
          effect_failed: executionOutcome('completed'),
          failed: executionOutcome('failed'),
          timed_out: executionOutcome('timed_out'),
        },
        {
          tracksExecution: true,
          completion: {
            executionEffectFreeWhen: {
              resultPath: ['executionEffectState'],
              values: ['none_observed'],
            },
            executionEffectAcknowledgedWhen: [
              {
                resultPath: ['workspaceMutationState'],
                values: ['applied'],
              },
              {
                resultPath: ['networkMutationState'],
                values: ['none_observed'],
              },
            ],
          },
        },
      ),
      completionMode: 'operational' as const,
      receiptSettlementMode: 'acknowledged_returned_unverified' as const,
    }),
    // Workspace writes read the exact resource back after mutation. A result
    // is verified only when that readback matches the requested content.
    write_file: effectful(
      'artifact.write',
      { written: VERIFIED, written_unverified: APPLIED },
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
      { edited: VERIFIED, edited_unverified: APPLIED },
      {
        resource: resourceSelector('workspace_file', 'result', ['path'], ['sha256']),
        completion: {
          resource: selector('workspace_file', 'arguments', ['path']),
        },
      },
    ),
    memory_remember: effectful(
      'memory.write',
      { created: VERIFIED, duplicate: VERIFIED, rejected: FAILED },
      { resource: selector('memory_fact', 'result', ['fact', 'id']) },
    ),
    memory_preserve_source: effectful(
      'memory.write',
      { created: VERIFIED, duplicate: VERIFIED, rejected: FAILED },
      { resource: selector('memory_fact', 'result', ['fact', 'id']) },
    ),
    memory_forget: effectful(
      'memory.delete',
      { withdrawn: VERIFIED, already_withdrawn: VERIFIED, rejected: FAILED },
      {
        resource: selector('memory_fact', 'result', ['factId']),
        completion: { resource: selector('memory_fact', 'arguments', ['factId']) },
      },
    ),
    memory_manage: effectful(
      'memory.update',
      { pinned: VERIFIED, unpinned: VERIFIED, invalidated: VERIFIED, rejected: FAILED },
      {
        resource: selector('memory_fact', 'arguments', ['factId']),
        completion: { resource: selector('memory_fact', 'arguments', ['factId']) },
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
    // Operational mutations are explicit code-owned effects, but their return
    // values never prove user-level completion. A later graph terminal event
    // or independent observation must provide completion evidence.
    sessions_spawn: returnedOperational('workflow.start'),
    sessions_send: returnedOperational('workflow.mutate'),
    sessions_cancel: returnedOperational('workflow.mutate'),
    mobile_ui_action: trackedOperational('unknown'),
    workspace_delegate_task: operational('workflow.start'),
    skill__github__create_branch: operational('remote.mutate'),
    skill__github__commit_files: operational('remote.mutate'),
    skill__github__create_issue: operational('remote.mutate'),
    skill__github__create_pull_request: operational('remote.mutate'),
    // Scheduler mutations return only after the code-owned store has durably
    // persisted the new state. Treat that acknowledged durable state as the
    // mutation verifier; list remains explicitly effect-free.
    cron: effectful(
      'workflow.mutate',
      {
        task_created: VERIFIED,
        updated: VERIFIED,
        deleted: VERIFIED,
        enabled: VERIFIED,
        disabled: VERIFIED,
        succeeded: VERIFIED,
        rejected: FAILED,
        listed: outcome('none', 'not_applicable', 'observation.read'),
      },
      { completion: { effectFreeWhen: { argumentPath: ['action'], values: ['list'] } } },
    ),
    canvas_eval: operational('compute.execute'),
    ssh_exec: operational('remote.mutate'),
    ssh_fs: operational('remote.mutate'),
    expo_eas_create_project: operational('remote.mutate'),
    expo_eas_build: operational('workflow.start'),
    expo_eas_update: operational('workflow.start'),
    expo_eas_submit: operational('workflow.start'),
    expo_eas_deploy_web: operational('workflow.start'),
    expo_eas_graphql: operational('remote.mutate'),
    browser_launch: operational('workflow.start'),
    browser_stop: operational('workflow.mutate'),
    browser_navigate: operational('navigation.open'),
    browser_click: operational('remote.mutate'),
    browser_type: operational('remote.mutate'),
    browser_press_key: operational('remote.mutate'),
    browser_hover: operational('remote.mutate'),
    browser_select: operational('remote.mutate'),
    browser_drag: operational('remote.mutate'),
    browser_screenshot: operational('observation.read'),
    browser_cookies: operational('remote.mutate'),
    browser_storage: operational('remote.mutate'),
    browser_evaluate: operational('compute.execute'),
    browser_upload: operational('remote.mutate'),
    browser_download: operational('artifact.write'),
    browser_pdf: operational('artifact.write'),
    browser_fill_form: operational('remote.mutate'),
    browser_dialog: operational('remote.mutate'),
    workspace_launch_browser: operational('workflow.start'),
    ...READ_ONLY_CONTRACTS,
    calendar_create_event: effectful(
      'calendar.create',
      nativeOutcomes({ created_verified: VERIFIED, created_unverified: APPLIED }),
      { resource: selector('calendar_event', 'result', ['eventId']) },
    ),
    calendar_update_event: effectful(
      'calendar.update',
      nativeOutcomes({ updated_verified: VERIFIED, updated_unverified: APPLIED }),
      { resource: selector('calendar_event', 'result', ['eventId']) },
    ),
    clipboard_write: effectful('clipboard.write', {
      written_verified: VERIFIED,
      written_unverified: APPLIED,
    }),
    clipboard: effectful(
      'clipboard.write',
      {
        read: outcome('none', 'not_applicable', 'observation.read'),
        written_verified: VERIFIED,
        written_unverified: APPLIED,
      },
      { completion: { effectFreeWhen: { argumentPath: ['action'], values: ['read'] } } },
    ),
    email_compose: effectful(
      'communication.send',
      nativeOutcomes({
        sent: APPLIED,
        saved: outcome('applied', 'acknowledged', 'communication.draft_save'),
        fallback_opened: outcome('handed_off', 'unverified', 'communication.draft_handoff'),
      }),
    ),
    sms_compose: effectful(
      'communication.draft_handoff',
      nativeOutcomes({
        sent: VERIFIED,
        unknown: VERIFIED,
        sms_composer_opened: VERIFIED,
      }),
    ),
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
      {
        statusPath: ['code'],
        completion: { effectFreeWhen: { argumentPath: ['action'], values: ['view'] } },
      },
    ),
    contacts_share: effectful('share.handoff', nativeOutcomes({ handed_off: VERIFIED_HANDOFF })),
    share_contact: effectful('share.handoff', nativeOutcomes({ handed_off: VERIFIED_HANDOFF })),
    share_text: effectful('share.handoff', nativeOutcomes({ handed_off: VERIFIED_HANDOFF })),
    share_url: effectful('share.handoff', nativeOutcomes({ handed_off: VERIFIED_HANDOFF })),
    share_file: effectful('share.handoff', nativeOutcomes({ handed_off: VERIFIED_HANDOFF })),
    share: effectful('share.handoff', nativeOutcomes({ handed_off: VERIFIED_HANDOFF })),
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
      { notification_scheduled: VERIFIED },
      {
        resource: selector('notification', 'result', ['id']),
        operationHandle: selector('notification_schedule', 'result', ['id']),
      },
    ),
    notification_cancel: effectful(
      'notification.cancel',
      { notification_cancelled: VERIFIED },
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
