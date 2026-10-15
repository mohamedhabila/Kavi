import { parse as shellParse } from 'shell-quote';

import { i18n } from '../../i18n/manager';
import { humanizeToolName } from '../../utils/toolDisplayName';
import { formatZonedIso } from '../scheduler/reminders/format';
import { computeReminderNextFireAtMs } from '../scheduler/reminders/recurrence';
import { parseReminderWhen, resolveReminderTimezone } from '../scheduler/reminders/input';

export type ToolTelemetryCategory = 'native' | 'ssh' | 'workspace' | 'browser' | 'expo' | 'other';

export interface ToolInvocationPresentation {
  category: ToolTelemetryCategory;
  title: string;
  description: string;
  redactedArguments: string;
  piiRedacted: boolean;
}

function parseToolArguments(
  input: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!input) {
    return {};
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  return input;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== undefined && value !== null && value !== false,
    ),
  );
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function getUrlScheme(value: unknown): string | undefined {
  if (!hasNonEmptyString(value)) {
    return undefined;
  }

  const match = String(value)
    .trim()
    .match(/^([a-z][a-z0-9+.-]*):/i);
  return match?.[1]?.toLowerCase();
}

/**
 * Best-effort human-readable next-fire preview for the reminder approval
 * dialog, built from the same structured-input parsing the reminder tool
 * executor uses. Never throws: an unparsable `when` simply omits the detail,
 * since the executor is the source of truth for actual validation.
 */
function describeReminderWhen(when: unknown, timezone: unknown): string | undefined {
  const whenResult = parseReminderWhen(when);
  if (!whenResult.ok) return undefined;
  const tzResult = resolveReminderTimezone(timezone);
  if (!tzResult.ok) return undefined;
  const nextFireAtMs = computeReminderNextFireAtMs(whenResult.recurrence, tzResult.timezone, Date.now());
  if (nextFireAtMs === undefined) return undefined;
  return formatZonedIso(nextFireAtMs, tzResult.timezone);
}

function getReminderTitle(args: Record<string, unknown>): string {
  const action = hasNonEmptyString(args.action) ? String(args.action).toLowerCase() : '';
  switch (action) {
    case 'update':
      return i18n.t('toolApproval.actions.reminderUpdateTitle');
    case 'cancel':
      return i18n.t('toolApproval.actions.reminderCancelTitle');
    case 'list':
      return i18n.t('toolApproval.actions.reminderListTitle');
    default:
      return i18n.t('toolApproval.actions.reminderCreateTitle');
  }
}

const translate = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);

function pushDetail(details: string[], key: string, params?: Record<string, string | number>) {
  details.push(i18n.t(key, params));
}

function stringifyRedactedArguments(record: Record<string, unknown>): string {
  return JSON.stringify(compactRecord(record));
}

function getToolTelemetryCategory(toolName: string): ToolTelemetryCategory {
  if (
    toolName.startsWith('calendar_') ||
    toolName.startsWith('contacts_') ||
    toolName.startsWith('location_') ||
    toolName.startsWith('clipboard_') ||
    toolName.startsWith('device_') ||
    toolName.startsWith('photos_') ||
    toolName.startsWith('camera_') ||
    toolName === 'email_compose' ||
    toolName === 'sms_compose' ||
    toolName === 'sms_send' ||
    toolName === 'chat_compose' ||
    toolName === 'phone_call' ||
    toolName === 'maps_open' ||
    toolName === 'notifications_read' ||
    toolName === 'notifications_reply' ||
    toolName === 'screen_record' ||
    toolName === 'open_url' ||
    toolName.startsWith('share_') ||
    toolName.startsWith('notification_') ||
    toolName === 'reminder'
  ) {
    return 'native';
  }

  if (toolName.startsWith('ssh_')) {
    return 'ssh';
  }

  if (toolName.startsWith('workspace_')) {
    return 'workspace';
  }

  if (toolName.startsWith('browser_')) {
    return 'browser';
  }

  if (toolName.startsWith('expo_eas_')) {
    return 'expo';
  }

  return 'other';
}

function getToolTitle(toolName: string): string {
  switch (toolName) {
    case 'email_compose':
      return i18n.t('toolApproval.actions.emailComposeTitle');
    case 'sms_compose':
      return i18n.t('toolApproval.actions.smsComposeTitle');
    case 'sms_send':
      return i18n.t('toolApproval.actions.smsSendTitle');
    case 'chat_compose':
      return i18n.t('toolApproval.actions.chatComposeTitle');
    case 'phone_call':
      return i18n.t('toolApproval.actions.phoneCallTitle');
    case 'maps_open':
      return i18n.t('toolApproval.actions.mapsOpenTitle');
    case 'contacts_pick':
      return i18n.t('toolApproval.actions.contactsPickTitle');
    case 'contacts_manage_access':
      return i18n.t('toolApproval.actions.contactsManageAccessTitle');
    case 'contacts_view':
      return i18n.t('toolApproval.actions.contactsViewTitle');
    case 'contacts_edit':
      return i18n.t('toolApproval.actions.contactsEditTitle');
    case 'contacts_create':
      return i18n.t('toolApproval.actions.contactsCreateTitle');
    case 'contacts_share':
      return i18n.t('toolApproval.actions.contactsShareTitle');
    case 'contacts_search':
      return i18n.t('toolApproval.actions.contactsSearchFullTitle');
    case 'contacts_get':
      return i18n.t('toolApproval.actions.contactsGetFullTitle');
    case 'notifications_read':
      return i18n.t('toolApproval.actions.notificationsReadTitle');
    case 'notifications_reply':
      return i18n.t('toolApproval.actions.notificationsReplyTitle');
    case 'share_text':
      return i18n.t('toolApproval.actions.shareTextTitle');
    case 'share_file':
      return i18n.t('toolApproval.actions.shareFileTitle');
    case 'open_url':
      return i18n.t('toolApproval.actions.openUrlTitle');
    case 'ssh_exec':
      return i18n.t('toolApproval.actions.sshExecTitle');
    case 'browser_navigate':
      return i18n.t('toolApproval.actions.browserNavigateTitle');
    case 'expo_eas_build':
      return i18n.t('toolApproval.actions.expoBuildTitle');
    default:
      return humanizeToolName(toolName, translate);
  }
}

/**
 * contacts_form opens the native view, edit or create form; its approval is presented as that
 * form, under the `contacts_view` / `contacts_edit` / `contacts_create` keys below.
 */
function resolveNativePresentationName(toolName: string, args: Record<string, unknown>): string {
  if (toolName !== 'contacts_form') return toolName;
  const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
  return action === 'view' || action === 'edit' || action === 'create'
    ? `contacts_${action}`
    : toolName;
}

function summarizeNativeTool(
  toolName: string,
  args: Record<string, unknown>,
): Pick<ToolInvocationPresentation, 'title' | 'description' | 'redactedArguments' | 'piiRedacted'> {
  const details: string[] = [];
  let redactedArguments: Record<string, unknown> = {};
  const presentationName = resolveNativePresentationName(toolName, args);

  switch (presentationName) {
    case 'calendar_list': {
      redactedArguments = {};
      break;
    }
    case 'calendar_events': {
      if (hasNonEmptyString(args.calendarId))
        pushDetail(details, 'toolApproval.details.providedArguments');
      redactedArguments = {
        hasStartDate: hasNonEmptyString(args.startDate),
        hasEndDate: hasNonEmptyString(args.endDate),
        hasCalendarId: hasNonEmptyString(args.calendarId),
      };
      break;
    }
    case 'calendar_create_event': {
      if (hasNonEmptyString(args.title)) pushDetail(details, 'toolApproval.details.titleIncluded');
      if (hasNonEmptyString(args.location))
        pushDetail(details, 'toolApproval.details.labelIncluded');
      if (hasNonEmptyString(args.notes)) pushDetail(details, 'toolApproval.details.bodyIncluded');
      redactedArguments = {
        hasTitle: hasNonEmptyString(args.title),
        hasStartDate: hasNonEmptyString(args.startDate),
        hasEndDate: hasNonEmptyString(args.endDate),
        hasLocation: hasNonEmptyString(args.location),
        hasNotes: hasNonEmptyString(args.notes),
        hasCalendarId: hasNonEmptyString(args.calendarId),
        allDay: args.allDay === true,
      };
      break;
    }
    case 'calendar_update_event': {
      pushDetail(details, 'toolApproval.details.providedArguments');
      redactedArguments = {
        hasId: hasNonEmptyString(args.id),
        hasTitle: hasNonEmptyString(args.title),
        hasStartDate: hasNonEmptyString(args.startDate),
        hasEndDate: hasNonEmptyString(args.endDate),
        hasLocation: hasNonEmptyString(args.location),
        hasNotes: hasNonEmptyString(args.notes),
        allDay: args.allDay === true,
      };
      break;
    }
    case 'email_compose': {
      const recipientCount =
        countArray(args.recipients) +
        countArray(args.ccRecipients) +
        countArray(args.bccRecipients);
      const attachmentCount = countArray(args.attachments);
      if (recipientCount > 0)
        pushDetail(details, 'toolApproval.details.recipientCount', { count: recipientCount });
      if (hasNonEmptyString(args.subject))
        pushDetail(details, 'toolApproval.details.subjectIncluded');
      if (hasNonEmptyString(args.body)) pushDetail(details, 'toolApproval.details.bodyIncluded');
      if (args.isHtml === true) pushDetail(details, 'toolApproval.details.htmlIncluded');
      if (attachmentCount > 0)
        pushDetail(details, 'toolApproval.details.attachmentCount', { count: attachmentCount });
      if (args.fallbackToMailto === true)
        pushDetail(details, 'toolApproval.details.fallbackEnabled');

      redactedArguments = {
        recipientCount,
        ccCount: countArray(args.ccRecipients),
        bccCount: countArray(args.bccRecipients),
        hasSubject: hasNonEmptyString(args.subject),
        hasBody: hasNonEmptyString(args.body),
        isHtml: args.isHtml === true,
        attachmentCount,
        fallbackToMailto: args.fallbackToMailto === true,
      };
      break;
    }
    case 'sms_compose':
    case 'sms_send': {
      const recipientCount = countArray(args.recipients);
      const attachmentCount = countArray(args.attachments);
      if (recipientCount > 0)
        pushDetail(details, 'toolApproval.details.recipientCount', { count: recipientCount });
      if (hasNonEmptyString(args.message))
        pushDetail(details, 'toolApproval.details.messageIncluded');
      if (attachmentCount > 0)
        pushDetail(details, 'toolApproval.details.attachmentCount', { count: attachmentCount });
      if (hasNonEmptyString(args.defaultCountry)) {
        pushDetail(details, 'toolApproval.details.defaultCountry', {
          code: String(args.defaultCountry).toUpperCase(),
        });
      }

      redactedArguments = {
        recipientCount,
        hasMessage: hasNonEmptyString(args.message),
        attachmentCount,
        defaultCountry: hasNonEmptyString(args.defaultCountry)
          ? String(args.defaultCountry).toUpperCase()
          : undefined,
      };
      break;
    }
    case 'chat_compose': {
      if (hasNonEmptyString(args.message))
        pushDetail(details, 'toolApproval.details.messageIncluded');
      redactedArguments = {
        app: typeof args.app === 'string' ? args.app : undefined,
        hasNumber: hasNonEmptyString(args.phoneNumber),
        hasMessage: hasNonEmptyString(args.message),
      };
      break;
    }
    case 'phone_call': {
      pushDetail(details, 'toolApproval.details.contactReference');
      if (hasNonEmptyString(args.defaultCountry)) {
        pushDetail(details, 'toolApproval.details.defaultCountry', {
          code: String(args.defaultCountry).toUpperCase(),
        });
      }
      redactedArguments = {
        hasNumber: hasNonEmptyString(args.number),
        defaultCountry: hasNonEmptyString(args.defaultCountry)
          ? String(args.defaultCountry).toUpperCase()
          : undefined,
      };
      break;
    }
    case 'maps_open': {
      if (hasNonEmptyString(args.query)) pushDetail(details, 'toolApproval.details.queryIncluded');
      if (typeof args.latitude === 'number' && typeof args.longitude === 'number') {
        pushDetail(details, 'toolApproval.details.coordinatesIncluded');
      }
      if (hasNonEmptyString(args.label)) pushDetail(details, 'toolApproval.details.labelIncluded');
      redactedArguments = {
        hasQuery: hasNonEmptyString(args.query),
        hasCoordinates: typeof args.latitude === 'number' && typeof args.longitude === 'number',
        hasLabel: hasNonEmptyString(args.label),
      };
      break;
    }
    case 'contacts_manage_access': {
      pushDetail(details, 'toolApproval.details.accessReview');
      redactedArguments = { mode: 'limited-access' };
      break;
    }
    case 'contacts_pick': {
      redactedArguments = {};
      break;
    }
    case 'contacts_view':
    case 'contacts_share':
    case 'contacts_get': {
      pushDetail(details, 'toolApproval.details.contactReference');
      redactedArguments = { hasId: hasNonEmptyString(args.id) };
      break;
    }
    case 'contacts_edit': {
      pushDetail(details, 'toolApproval.details.contactReference');
      pushDetail(details, 'toolApproval.details.prefilledFields');
      redactedArguments = {
        hasId: hasNonEmptyString(args.id),
        emailCount: countArray(args.emails),
        phoneCount: countArray(args.phoneNumbers),
        hasNameFields: ['firstName', 'middleName', 'lastName'].some((field) =>
          hasNonEmptyString(args[field]),
        ),
      };
      break;
    }
    case 'contacts_create': {
      if (
        countArray(args.emails) > 0 ||
        countArray(args.phoneNumbers) > 0 ||
        hasNonEmptyString(args.firstName) ||
        hasNonEmptyString(args.lastName)
      ) {
        pushDetail(details, 'toolApproval.details.prefilledFields');
      }
      redactedArguments = {
        emailCount: countArray(args.emails),
        phoneCount: countArray(args.phoneNumbers),
        hasNameFields: ['firstName', 'middleName', 'lastName'].some((field) =>
          hasNonEmptyString(args[field]),
        ),
      };
      break;
    }
    case 'contacts_search': {
      pushDetail(details, 'toolApproval.details.queryIncluded');
      if (typeof args.limit === 'number')
        pushDetail(details, 'toolApproval.details.limit', { count: args.limit });
      redactedArguments = {
        hasQuery: hasNonEmptyString(args.query),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      };
      break;
    }
    case 'location_current': {
      redactedArguments = {};
      break;
    }
    case 'notifications_read': {
      if (typeof args.since_minutes === 'number')
        pushDetail(details, 'toolApproval.details.lookBackMinutes', { count: args.since_minutes });
      if (typeof args.limit === 'number')
        pushDetail(details, 'toolApproval.details.limit', { count: args.limit });
      redactedArguments = {
        sinceMinutes: typeof args.since_minutes === 'number' ? args.since_minutes : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      };
      break;
    }
    case 'notifications_reply': {
      if (hasNonEmptyString(args.message))
        pushDetail(details, 'toolApproval.details.textLength', {
          count: String(args.message).length,
        });
      redactedArguments = {
        hasNotification: hasNonEmptyString(args.id),
        messageLength: hasNonEmptyString(args.message) ? String(args.message).length : 0,
      };
      break;
    }
    case 'clipboard_read': {
      redactedArguments = {};
      break;
    }
    case 'clipboard_write': {
      if (hasNonEmptyString(args.text))
        pushDetail(details, 'toolApproval.details.textLength', { count: String(args.text).length });
      redactedArguments = {
        textLength: hasNonEmptyString(args.text) ? String(args.text).length : 0,
      };
      break;
    }
    case 'share_text': {
      if (hasNonEmptyString(args.text)) {
        pushDetail(details, 'toolApproval.details.textLength', { count: String(args.text).length });
      }
      if (hasNonEmptyString(args.title)) pushDetail(details, 'toolApproval.details.titleIncluded');
      redactedArguments = {
        textLength: hasNonEmptyString(args.text) ? String(args.text).length : 0,
        hasTitle: hasNonEmptyString(args.title),
      };
      break;
    }
    case 'share_file': {
      pushDetail(details, 'toolApproval.details.localFile');
      if (hasNonEmptyString(args.mimeType))
        pushDetail(details, 'toolApproval.details.mimeType', { mimeType: String(args.mimeType) });
      if (hasNonEmptyString(args.dialogTitle))
        pushDetail(details, 'toolApproval.details.titleIncluded');
      redactedArguments = {
        hasFileUri: hasNonEmptyString(args.fileUri),
        mimeType: hasNonEmptyString(args.mimeType) ? String(args.mimeType) : undefined,
        hasDialogTitle: hasNonEmptyString(args.dialogTitle),
        hasUti: hasNonEmptyString(args.uti),
      };
      break;
    }
    case 'open_url': {
      const scheme = getUrlScheme(args.url);
      if (scheme) pushDetail(details, 'toolApproval.details.scheme', { scheme });
      pushDetail(details, 'toolApproval.details.reviewedLink');
      redactedArguments = { scheme };
      break;
    }
    case 'notification_send': {
      if (hasNonEmptyString(args.title)) pushDetail(details, 'toolApproval.details.titleIncluded');
      if (hasNonEmptyString(args.body)) pushDetail(details, 'toolApproval.details.bodyIncluded');
      redactedArguments = {
        hasTitle: hasNonEmptyString(args.title),
        hasBody: hasNonEmptyString(args.body),
      };
      break;
    }
    case 'reminder': {
      const action = hasNonEmptyString(args.action) ? String(args.action).toLowerCase() : '';
      if (hasNonEmptyString(args.title)) pushDetail(details, 'toolApproval.details.titleIncluded');
      if (hasNonEmptyString(args.notes)) pushDetail(details, 'toolApproval.details.notesIncluded');
      if (action !== 'list') {
        const when = describeReminderWhen(args.when, args.timezone);
        if (when) pushDetail(details, 'toolApproval.details.reminderFires', { when });
      }
      if ((action === 'update' || action === 'cancel') && hasNonEmptyString(args.id)) {
        pushDetail(details, 'toolApproval.details.reminderReference');
      }
      redactedArguments = {
        action: action || undefined,
        hasId: hasNonEmptyString(args.id),
        hasTitle: hasNonEmptyString(args.title),
        hasNotes: hasNonEmptyString(args.notes),
        hasWhen: args.when !== undefined && args.when !== null,
      };
      break;
    }
    case 'device_query': {
      redactedArguments = {
        kind: hasNonEmptyString(args.kind) ? String(args.kind).toLowerCase() : undefined,
      };
      break;
    }
    case 'photos_pick': {
      if (typeof args.count === 'number')
        pushDetail(details, 'toolApproval.details.limit', { count: args.count });
      redactedArguments = {
        count: typeof args.count === 'number' ? args.count : undefined,
      };
      break;
    }
    case 'camera_clip': {
      redactedArguments = {
        durationSeconds:
          typeof args.durationSeconds === 'number' ? args.durationSeconds : undefined,
        quality: hasNonEmptyString(args.quality) ? String(args.quality).toLowerCase() : undefined,
        camera: hasNonEmptyString(args.camera) ? String(args.camera).toLowerCase() : undefined,
      };
      break;
    }
    case 'screen_record': {
      redactedArguments = {
        format: hasNonEmptyString(args.format) ? String(args.format).toLowerCase() : undefined,
      };
      break;
    }
    default: {
      pushDetail(details, 'toolApproval.details.providedArguments');
      redactedArguments = { argumentCount: Object.keys(args).length };
      break;
    }
  }

  return {
    title: toolName === 'reminder' ? getReminderTitle(args) : getToolTitle(presentationName),
    description:
      details.length > 0
        ? `${details.join(' · ')}. ${i18n.t('toolApproval.redactedNotice')}`
        : i18n.t('toolApproval.genericDescription'),
    redactedArguments: stringifyRedactedArguments(redactedArguments),
    piiRedacted: true,
  };
}

function summarizeSshTool(
  toolName: string,
  args: Record<string, unknown>,
): Pick<ToolInvocationPresentation, 'title' | 'description' | 'redactedArguments' | 'piiRedacted'> {
  const details: string[] = [];
  let executable = 'command';

  if (toolName === 'ssh_exec' && hasNonEmptyString(args.command)) {
    try {
      const parsed = shellParse(String(args.command));
      executable = parsed.find((token): token is string => typeof token === 'string') || executable;
    } catch {
      executable = 'command';
    }
    pushDetail(details, 'toolApproval.details.commandExecutable', { executable });
  }

  if (hasNonEmptyString(args.cwd)) pushDetail(details, 'toolApproval.details.workingDirectory');
  if (hasNonEmptyString(args.targetId)) pushDetail(details, 'toolApproval.details.targetSelected');

  return {
    title: getToolTitle(toolName),
    description:
      details.length > 0
        ? `${details.join(' · ')}. ${i18n.t('toolApproval.redactedNotice')}`
        : i18n.t('toolApproval.genericDescription'),
    redactedArguments: stringifyRedactedArguments({
      executable,
      hasWorkingDirectory: hasNonEmptyString(args.cwd),
      hasTargetId: hasNonEmptyString(args.targetId),
    }),
    piiRedacted: true,
  };
}

function summarizeWorkspaceTool(
  toolName: string,
  args: Record<string, unknown>,
): Pick<ToolInvocationPresentation, 'title' | 'description' | 'redactedArguments' | 'piiRedacted'> {
  const details: string[] = [];
  switch (toolName) {
    case 'workspace_delegate_task':
      if (hasNonEmptyString(args.prompt))
        pushDetail(details, 'toolApproval.details.messageIncluded');
      break;
    case 'workspace_launch_browser':
      pushDetail(details, 'toolApproval.details.providedArguments');
      break;
    default:
      pushDetail(details, 'toolApproval.details.providedArguments');
      break;
  }

  return {
    title: getToolTitle(toolName),
    description: `${details.join(' · ')}. ${i18n.t('toolApproval.redactedNotice')}`,
    redactedArguments: stringifyRedactedArguments({
      hasTargetId: hasNonEmptyString(args.targetId),
      hasProviderId: hasNonEmptyString(args.providerId),
      hasPrompt: hasNonEmptyString(args.prompt),
      hasMode: hasNonEmptyString(args.mode),
    }),
    piiRedacted: true,
  };
}

export function describeToolInvocation(
  toolName: string,
  input?: string | Record<string, unknown>,
): ToolInvocationPresentation {
  const args = parseToolArguments(input);
  const category = getToolTelemetryCategory(toolName);

  if (category === 'native') {
    return {
      category,
      ...summarizeNativeTool(toolName, args),
    };
  }

  if (category === 'ssh') {
    return {
      category,
      ...summarizeSshTool(toolName, args),
    };
  }

  if (category === 'workspace') {
    return {
      category,
      ...summarizeWorkspaceTool(toolName, args),
    };
  }

  return {
    category,
    title: getToolTitle(toolName),
    description: `${humanizeToolName(toolName, translate)}. ${i18n.t('toolApproval.redactedNotice')}`,
    redactedArguments: stringifyRedactedArguments({ argumentCount: Object.keys(args).length }),
    piiRedacted: Object.keys(args).length > 0,
  };
}

export { getToolTelemetryCategory };
