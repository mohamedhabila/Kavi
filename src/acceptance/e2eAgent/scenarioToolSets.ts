// ---------------------------------------------------------------------------
// Kavi — E2E structural success criteria
// ---------------------------------------------------------------------------

export const E2E_CALENDAR_MUTATION_SUCCESS_CRITERIA = [
  'evidence.json_field:status:created',
  'evidence.json_field:status:updated',
];

export const E2E_CALENDAR_VERIFY_MUTATION_SUCCESS_CRITERIA = [
  'evidence.json_field:0.allowsModifications:true',
  ...E2E_CALENDAR_MUTATION_SUCCESS_CRITERIA,
];

export const E2E_CONTACT_SMS_SUCCESS_CRITERIA = [
  'evidence.json_field:0.id:e2e-contact-avery',
  'evidence.json_field:status:sms_composer_opened',
  'evidence.json_field:recipientCount:1',
];

export const E2E_CALENDAR_CONTACT_SMS_SUCCESS_CRITERIA = [
  'evidence.json_field:0.allowsModifications:true',
  ...E2E_CONTACT_SMS_SUCCESS_CRITERIA,
];

export const E2E_GOAL_JSON_FIELD_SUCCESS_CRITERIA = [
  'evidence.json_field:0.allowsModifications:true',
];

export const E2E_DEVICE_STATE_SUCCESS_CRITERIA = [
  'evidence.json_field:status:clipboard_written',
  'evidence.json_field:status:clipboard_read',
  'evidence.json_field:status:share_sheet_opened',
  'evidence.json_field:status:notification_scheduled',
  'evidence.json_field:status:notification_cancelled',
];

export const E2E_PERMISSION_MAPS_SUCCESS_CRITERIA = [
  'evidence.json_field:current.location:denied',
  'evidence.json_field:current.mediaLibrary:revoked',
  'evidence.json_field:status:permission_denied',
  'evidence.json_field:status:maps_opened',
];

export const E2E_MEDIA_STATE_SUCCESS_CRITERIA = [
  'evidence.json_field:length:2',
  'evidence.json_field:status:captured',
  'evidence.json_field:status:recorded',
];
