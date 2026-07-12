export const CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS = Object.freeze({
  androidPlatform: 'platform.android',
  iosPlatform: 'platform.ios',
  calendarPermissionGranted: 'os.calendar.permission.granted',
  calendarListAllowed: 'app.tool.calendar_list.allowed',
  calendarCreateAllowed: 'app.tool.calendar_create_event.allowed',
  writableCalendarObserved: 'calendar.list.returned-writable-id.v1',
} as const);

export function calendarVerifiedProcedureEnvironmentPreconditionIds(
  platform: 'android' | 'ios',
): readonly string[] {
  return Object.freeze(
    [
      platform === 'ios'
        ? CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.iosPlatform
        : CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.androidPlatform,
      CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarPermissionGranted,
      CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarListAllowed,
      CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarCreateAllowed,
    ].sort(),
  );
}

export function calendarVerifiedProcedureApplicablePreconditionIds(
  platform: 'android' | 'ios',
): readonly string[] {
  return Object.freeze(
    [
      ...calendarVerifiedProcedureEnvironmentPreconditionIds(platform),
      CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.writableCalendarObserved,
    ].sort(),
  );
}
