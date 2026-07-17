import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { isStoreHydrated, type PersistHydratableStore } from '../../../store/persistHydration';
import { useToolPermissionsStore } from '../../security/permissions';
import {
  calendarUpdateVerifiedProcedureEnvironmentPreconditionIds,
  calendarVerifiedProcedureEnvironmentPreconditionIds,
} from './calendarPreconditionContract';

export type CalendarVerifiedProcedurePreconditionReason =
  | 'satisfied'
  | 'unsupported_platform'
  | 'tool_policy_unavailable'
  | 'tool_not_allowed'
  | 'permission_not_granted'
  | 'permission_unavailable';

export type CalendarVerifiedProcedurePreconditions = Readonly<{
  satisfied: boolean;
  reason: CalendarVerifiedProcedurePreconditionReason;
  platform: 'android' | 'ios' | null;
  preconditionIds: readonly string[];
}>;

function mobilePlatform(): 'android' | 'ios' | null {
  return Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null;
}

function result(
  platform: 'android' | 'ios' | null,
  reason: CalendarVerifiedProcedurePreconditionReason,
  preconditionIds: readonly string[] = [],
): CalendarVerifiedProcedurePreconditions {
  return Object.freeze({
    satisfied: reason === 'satisfied',
    reason,
    platform,
    preconditionIds: Object.freeze([...preconditionIds].sort()),
  });
}

/**
 * Reads current applicability without prompting or enumerating calendars.
 * Permission requests and calendar discovery belong to an explicitly approved
 * execution, never to procedure retrieval or learning.
 */
async function resolveCalendarToolPreconditions(params: {
  toolNames: readonly [string, string];
  preconditionIds: (platform: 'android' | 'ios') => readonly string[];
}): Promise<CalendarVerifiedProcedurePreconditions> {
  const platform = mobilePlatform();
  if (!platform) return result(null, 'unsupported_platform');
  if (!isStoreHydrated(useToolPermissionsStore as PersistHydratableStore)) {
    return result(platform, 'tool_policy_unavailable');
  }

  let sourceAllowed = false;
  let targetAllowed = false;
  try {
    const permissions = useToolPermissionsStore.getState();
    sourceAllowed = permissions.isAllowed(params.toolNames[0]);
    targetAllowed = permissions.isAllowed(params.toolNames[1]);
  } catch {
    return result(platform, 'tool_policy_unavailable');
  }
  if (!sourceAllowed || !targetAllowed) {
    return result(platform, 'tool_not_allowed');
  }

  try {
    const permission = await Calendar.getCalendarPermissionsAsync();
    if (permission.status !== 'granted' || permission.granted !== true) {
      return result(platform, 'permission_not_granted');
    }
  } catch {
    return result(platform, 'permission_unavailable');
  }

  return result(platform, 'satisfied', params.preconditionIds(platform));
}

export async function resolveCalendarVerifiedProcedurePreconditions(): Promise<CalendarVerifiedProcedurePreconditions> {
  return resolveCalendarToolPreconditions({
    toolNames: ['calendar_list', 'calendar_create_event'],
    preconditionIds: calendarVerifiedProcedureEnvironmentPreconditionIds,
  });
}

export async function resolveCalendarUpdateVerifiedProcedurePreconditions(): Promise<CalendarVerifiedProcedurePreconditions> {
  return resolveCalendarToolPreconditions({
    toolNames: ['calendar_events', 'calendar_update_event'],
    preconditionIds: calendarUpdateVerifiedProcedureEnvironmentPreconditionIds,
  });
}
