jest.mock('expo-calendar', () => ({
  getCalendarPermissionsAsync: jest.fn().mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
  }),
  requestCalendarPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
}));

import { Platform } from 'react-native';
import {
  calendarUpdateVerifiedProcedureApplicablePreconditionIds,
  calendarVerifiedProcedureApplicablePreconditionIds,
  CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS,
} from '../../../src/services/memory/verifiedProcedure/calendarPreconditionContract';
import {
  resolveCalendarUpdateVerifiedProcedurePreconditions,
  resolveCalendarVerifiedProcedurePreconditions,
} from '../../../src/services/memory/verifiedProcedure/calendarPreconditions';
import { useToolPermissionsStore } from '../../../src/services/security/permissions';

const Calendar = jest.requireMock('expo-calendar') as {
  getCalendarPermissionsAsync: jest.Mock;
  requestCalendarPermissionsAsync: jest.Mock;
  getCalendarsAsync: jest.Mock;
};
const mutablePlatform = Platform as unknown as { OS: string };

beforeEach(() => {
  mutablePlatform.OS = 'ios';
  useToolPermissionsStore.setState({ permissions: [] });
  Calendar.getCalendarPermissionsAsync.mockReset().mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
  });
  Calendar.requestCalendarPermissionsAsync.mockReset();
  Calendar.getCalendarsAsync.mockReset();
});

afterEach(() => {
  useToolPermissionsStore.setState({ permissions: [] });
  jest.restoreAllMocks();
});

describe('calendar verified procedure preconditions', () => {
  it('adds current-run writable-calendar evidence only to the applicable procedure scope', () => {
    expect(calendarVerifiedProcedureApplicablePreconditionIds('ios')).toEqual(
      [
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarCreateAllowed,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarListAllowed,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.writableCalendarObserved,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarPermissionGranted,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.iosPlatform,
      ].sort(),
    );
    expect(calendarUpdateVerifiedProcedureApplicablePreconditionIds('ios')).toEqual(
      [
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarEventObserved,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarEventsAllowed,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarPermissionGranted,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarUpdateAllowed,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.iosPlatform,
      ].sort(),
    );
  });

  it.each([
    ['ios', CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.iosPlatform],
    ['android', CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.androidPlatform],
  ] as const)('resolves exact non-prompting %s applicability', async (platform, platformId) => {
    mutablePlatform.OS = platform;

    await expect(resolveCalendarVerifiedProcedurePreconditions()).resolves.toEqual({
      satisfied: true,
      reason: 'satisfied',
      platform,
      preconditionIds: [
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarCreateAllowed,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarListAllowed,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarPermissionGranted,
        platformId,
      ].sort(),
    });
    expect(Calendar.getCalendarPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.getCalendarsAsync).not.toHaveBeenCalled();
  });

  it('resolves the exact non-prompting event-update applicability', async () => {
    await expect(resolveCalendarUpdateVerifiedProcedurePreconditions()).resolves.toEqual({
      satisfied: true,
      reason: 'satisfied',
      platform: 'ios',
      preconditionIds: [
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarEventsAllowed,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarPermissionGranted,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarUpdateAllowed,
        CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.iosPlatform,
      ].sort(),
    });
    expect(Calendar.getCalendarPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.getCalendarsAsync).not.toHaveBeenCalled();
  });

  it('fails closed before touching OS permissions when either app tool is disabled', async () => {
    useToolPermissionsStore.getState().setPermission('calendar_create_event', false);

    await expect(resolveCalendarVerifiedProcedurePreconditions()).resolves.toEqual({
      satisfied: false,
      reason: 'tool_not_allowed',
      platform: 'ios',
      preconditionIds: [],
    });
    expect(Calendar.getCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.getCalendarsAsync).not.toHaveBeenCalled();

    useToolPermissionsStore.setState({ permissions: [] });
    useToolPermissionsStore.getState().setPermission('calendar_update_event', false);
    await expect(resolveCalendarUpdateVerifiedProcedurePreconditions()).resolves.toEqual({
      satisfied: false,
      reason: 'tool_not_allowed',
      platform: 'ios',
      preconditionIds: [],
    });
    expect(Calendar.getCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not trust default tool state before persisted permissions hydrate', async () => {
    jest.spyOn(useToolPermissionsStore.persist, 'hasHydrated').mockReturnValue(false);

    await expect(resolveCalendarVerifiedProcedurePreconditions()).resolves.toEqual({
      satisfied: false,
      reason: 'tool_policy_unavailable',
      platform: 'ios',
      preconditionIds: [],
    });
    expect(Calendar.getCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.getCalendarsAsync).not.toHaveBeenCalled();
  });

  it('does not prompt or enumerate when calendar access is not already granted', async () => {
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: true,
      expires: 'never',
    });

    await expect(resolveCalendarVerifiedProcedurePreconditions()).resolves.toEqual({
      satisfied: false,
      reason: 'permission_not_granted',
      platform: 'ios',
      preconditionIds: [],
    });
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.getCalendarsAsync).not.toHaveBeenCalled();
  });

  it('fails closed on unsupported platforms and permission-read failures', async () => {
    mutablePlatform.OS = 'web';
    await expect(resolveCalendarVerifiedProcedurePreconditions()).resolves.toEqual({
      satisfied: false,
      reason: 'unsupported_platform',
      platform: null,
      preconditionIds: [],
    });
    expect(Calendar.getCalendarPermissionsAsync).not.toHaveBeenCalled();

    mutablePlatform.OS = 'android';
    Calendar.getCalendarPermissionsAsync.mockRejectedValue(new Error('native unavailable'));
    await expect(resolveCalendarVerifiedProcedurePreconditions()).resolves.toEqual({
      satisfied: false,
      reason: 'permission_unavailable',
      platform: 'android',
      preconditionIds: [],
    });
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.getCalendarsAsync).not.toHaveBeenCalled();
  });
});
