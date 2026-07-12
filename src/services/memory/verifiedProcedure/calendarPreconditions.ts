import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { isStoreHydrated, type PersistHydratableStore } from '../../../store/persistHydration';
import { useToolPermissionsStore } from '../../security/permissions';
import { calendarVerifiedProcedureEnvironmentPreconditionIds } from './calendarPreconditionContract';

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
export async function resolveCalendarVerifiedProcedurePreconditions(): Promise<CalendarVerifiedProcedurePreconditions> {
  const platform = mobilePlatform();
  if (!platform) return result(null, 'unsupported_platform');
  if (!isStoreHydrated(useToolPermissionsStore as PersistHydratableStore)) {
    return result(platform, 'tool_policy_unavailable');
  }

  let listAllowed = false;
  let createAllowed = false;
  try {
    const permissions = useToolPermissionsStore.getState();
    listAllowed = permissions.isAllowed('calendar_list');
    createAllowed = permissions.isAllowed('calendar_create_event');
  } catch {
    return result(platform, 'tool_policy_unavailable');
  }
  if (!listAllowed || !createAllowed) {
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

  return result(
    platform,
    'satisfied',
    calendarVerifiedProcedureEnvironmentPreconditionIds(platform),
  );
}
