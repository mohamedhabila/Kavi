export const CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS = Object.freeze({
  androidPlatform: 'platform.android',
  iosPlatform: 'platform.ios',
  calendarPermissionGranted: 'os.calendar.permission.granted',
  calendarListAllowed: 'app.tool.calendar_list.allowed',
  calendarCreateAllowed: 'app.tool.calendar_create_event.allowed',
  calendarEventsAllowed: 'app.tool.calendar_events.allowed',
  calendarUpdateAllowed: 'app.tool.calendar_update_event.allowed',
  writableCalendarObserved: 'calendar.list.returned-writable-id.v1',
  calendarEventObserved: 'calendar.events.returned-event-id.v1',
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

export function calendarUpdateVerifiedProcedureEnvironmentPreconditionIds(
  platform: 'android' | 'ios',
): readonly string[] {
  return Object.freeze(
    [
      platform === 'ios'
        ? CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.iosPlatform
        : CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.androidPlatform,
      CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarPermissionGranted,
      CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarEventsAllowed,
      CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarUpdateAllowed,
    ].sort(),
  );
}

export function calendarUpdateVerifiedProcedureApplicablePreconditionIds(
  platform: 'android' | 'ios',
): readonly string[] {
  return Object.freeze(
    [
      ...calendarUpdateVerifiedProcedureEnvironmentPreconditionIds(platform),
      CALENDAR_VERIFIED_PROCEDURE_PRECONDITION_IDS.calendarEventObserved,
    ].sort(),
  );
}
