// ---------------------------------------------------------------------------
// Kavi — Native Device Tool Definitions
// ---------------------------------------------------------------------------
// Calendar, contacts, location, camera, clipboard, share.
// Using Expo libraries for all native access.

import { ToolDefinition } from '../../types';

export const CALENDAR_LIST_TOOL: ToolDefinition = {
  name: 'calendar_list',
  description: 'List all calendars on the device.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const CALENDAR_EVENTS_TOOL: ToolDefinition = {
  name: 'calendar_events',
  description: 'Get calendar events within a date range.',
  input_schema: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Start date (ISO 8601)' },
      endDate: { type: 'string', description: 'End date (ISO 8601)' },
      calendarId: { type: 'string', description: 'Specific calendar ID (optional)' },
    },
    required: ['startDate', 'endDate'],
  },
};

export const CALENDAR_CREATE_TOOL: ToolDefinition = {
  name: 'calendar_create_event',
  description:
    'Create a new calendar event. IMPORTANT: Always call calendar_list first to get a valid calendarId. Use ISO 8601 dates (e.g. 2025-03-20T10:00:00). endDate MUST be after startDate.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title' },
      startDate: {
        type: 'string',
        description: 'Start date/time in ISO 8601 (e.g. 2025-03-20T10:00:00)',
      },
      endDate: {
        type: 'string',
        description:
          'End date/time in ISO 8601. Must be after startDate. For 1-hour events, add 1 hour to startDate.',
      },
      location: { type: 'string', description: 'Event location (optional)' },
      notes: { type: 'string', description: 'Event notes (optional)' },
      calendarId: {
        type: 'string',
        description:
          'Calendar ID from calendar_list. If omitted, uses the default writable calendar.',
      },
      allDay: { type: 'boolean', description: 'If true, creates an all-day event' },
    },
    required: ['title', 'startDate', 'endDate'],
  },
};

const CONTACT_CHANNEL_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Label such as mobile, work, or home' },
    value: { type: 'string', description: 'Channel value' },
  },
  required: ['value'],
};

const CONTACT_MUTATION_PROPERTIES = {
  firstName: { type: 'string', description: 'Contact first name' },
  middleName: { type: 'string', description: 'Contact middle name' },
  lastName: { type: 'string', description: 'Contact last name' },
  company: { type: 'string', description: 'Company or organization name' },
  jobTitle: { type: 'string', description: 'Job title' },
  note: { type: 'string', description: 'Optional note' },
  emails: {
    type: 'array',
    description: 'Optional email addresses to prefill',
    items: CONTACT_CHANNEL_SCHEMA,
  },
  phoneNumbers: {
    type: 'array',
    description: 'Optional phone numbers to prefill',
    items: CONTACT_CHANNEL_SCHEMA,
  },
};

export const EMAIL_COMPOSE_TOOL: ToolDefinition = {
  name: 'email_compose',
  description:
    'Compose an email using the native mail composer. Prefer this over open_url with mailto:.',
  input_schema: {
    type: 'object',
    properties: {
      recipients: {
        type: 'array',
        items: { type: 'string' },
        description: 'Primary recipient email addresses',
      },
      ccRecipients: {
        type: 'array',
        items: { type: 'string' },
        description: 'CC recipient email addresses',
      },
      bccRecipients: {
        type: 'array',
        items: { type: 'string' },
        description: 'BCC recipient email addresses',
      },
      subject: { type: 'string', description: 'Email subject' },
      body: { type: 'string', description: 'Email body' },
      isHtml: { type: 'boolean', description: 'Set true when body contains HTML' },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional local file:// URIs to attach',
      },
      fallbackToMailto: {
        type: 'boolean',
        description:
          'Allow fallback to the default mail app when the composer is unavailable (default: true)',
      },
    },
  },
};

export const SMS_COMPOSE_TOOL: ToolDefinition = {
  name: 'sms_compose',
  description: 'Compose an SMS or text message using the native system composer.',
  input_schema: {
    type: 'object',
    properties: {
      recipients: {
        type: 'array',
        items: { type: 'string' },
        description: 'Recipient phone numbers',
      },
      message: { type: 'string', description: 'Message body' },
      defaultCountry: {
        type: 'string',
        description: 'Optional two-letter ISO country code for local phone number parsing',
      },
      attachments: {
        type: 'array',
        description: 'Optional SMS attachments where supported',
        items: {
          type: 'object',
          properties: {
            uri: { type: 'string', description: 'Attachment content:// or file:// URI' },
            mimeType: { type: 'string', description: 'Attachment MIME type' },
            filename: { type: 'string', description: 'Attachment filename' },
          },
          required: ['uri', 'mimeType', 'filename'],
        },
      },
    },
    required: ['recipients', 'message'],
  },
};

export const PHONE_CALL_TOOL: ToolDefinition = {
  name: 'phone_call',
  description: 'Open the native dialer for a phone number. Use this instead of open_url with tel:.',
  input_schema: {
    type: 'object',
    properties: {
      number: { type: 'string', description: 'Phone number to dial' },
      defaultCountry: {
        type: 'string',
        description: 'Optional two-letter ISO country code for local phone number parsing',
      },
    },
    required: ['number'],
  },
};

export const MAPS_OPEN_TOOL: ToolDefinition = {
  name: 'maps_open',
  description: 'Open the native maps app for a search query or coordinates.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Address or place search query' },
      latitude: { type: 'number', description: 'Latitude coordinate' },
      longitude: { type: 'number', description: 'Longitude coordinate' },
      label: { type: 'string', description: 'Optional display label for the location' },
    },
    oneOf: [{ required: ['query'] }, { required: ['latitude', 'longitude'] }],
  },
};

export const CONTACTS_PICK_TOOL: ToolDefinition = {
  name: 'contacts_pick',
  description: 'Open the native contact picker and return a single selected contact preview.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const CONTACTS_MANAGE_ACCESS_TOOL: ToolDefinition = {
  name: 'contacts_manage_access',
  description:
    'On iOS limited-contact access, open the native picker so the user can grant this app access to additional contacts.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const CONTACTS_VIEW_TOOL: ToolDefinition = {
  name: 'contacts_view',
  description: 'Open the native contact viewer for a specific contact id.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Contact id to open' },
    },
    required: ['id'],
  },
};

export const CONTACTS_EDIT_TOOL: ToolDefinition = {
  name: 'contacts_edit',
  description:
    'Open the native contact editor for an existing contact, optionally prefilled with field changes.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Contact id to edit' },
      ...CONTACT_MUTATION_PROPERTIES,
    },
    required: ['id'],
  },
};

export const CONTACTS_CREATE_TOOL: ToolDefinition = {
  name: 'contacts_create',
  description: 'Open the native create-contact form, optionally prefilled with initial values.',
  input_schema: {
    type: 'object',
    properties: CONTACT_MUTATION_PROPERTIES,
  },
};

export const CONTACTS_SHARE_TOOL: ToolDefinition = {
  name: 'contacts_share',
  description: 'Share a contact using the native contact share flow.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Contact id to share' },
      message: {
        type: 'string',
        description: 'Optional message to include with the shared contact',
      },
    },
    required: ['id'],
  },
};

export const CONTACTS_SEARCH_FULL_TOOL: ToolDefinition = {
  name: 'contacts_search_full',
  description:
    'Search the contact library by name using full contacts permission. Prefer contacts_pick when possible.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name search query' },
      limit: { type: 'number', description: 'Max results (default: 10, max: 25)' },
    },
    required: ['query'],
  },
};

export const CONTACTS_GET_FULL_TOOL: ToolDefinition = {
  name: 'contacts_get_full',
  description: 'Get full contact details for a specific contact id using full contacts permission.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Contact id' },
    },
    required: ['id'],
  },
};

export const CONTACTS_SEARCH_TOOL: ToolDefinition = {
  name: 'contacts_search',
  description:
    'Legacy alias for full contact search by name. Prefer contacts_pick or contacts_search_full.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name search query' },
      limit: { type: 'number', description: 'Max results (default: 10, max: 25)' },
    },
    required: ['query'],
  },
};

export const CONTACTS_GET_TOOL: ToolDefinition = {
  name: 'contacts_get',
  description: 'Legacy alias for contacts_get_full.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Contact ID' },
    },
    required: ['id'],
  },
};

export const LOCATION_CURRENT_TOOL: ToolDefinition = {
  name: 'location_current',
  description: 'Get the current GPS location (latitude, longitude, altitude).',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const CLIPBOARD_READ_TOOL: ToolDefinition = {
  name: 'clipboard_read',
  description: 'Read the current text from the system clipboard.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const CLIPBOARD_WRITE_TOOL: ToolDefinition = {
  name: 'clipboard_write',
  description: 'Write text to the system clipboard.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to copy to clipboard' },
    },
    required: ['text'],
  },
};

export const SHARE_TOOL: ToolDefinition = {
  name: 'share',
  description:
    'Legacy compatibility share tool for text or URLs. Prefer share_text, share_url, share_file, or contacts_share.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to share' },
      url: { type: 'string', description: 'URL to share' },
    },
  },
};

export const SHARE_TEXT_TOOL: ToolDefinition = {
  name: 'share_text',
  description: 'Share plain text using the native share sheet.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to share' },
      title: { type: 'string', description: 'Optional share-sheet title' },
    },
    required: ['text'],
  },
};

export const SHARE_URL_TOOL: ToolDefinition = {
  name: 'share_url',
  description: 'Share an HTTP or HTTPS URL using the native share sheet.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP or HTTPS URL to share' },
      message: { type: 'string', description: 'Optional message to include with the URL' },
      title: { type: 'string', description: 'Optional share-sheet title' },
    },
    required: ['url'],
  },
};

export const SHARE_FILE_TOOL: ToolDefinition = {
  name: 'share_file',
  description: 'Share a local file using the native share sheet.',
  input_schema: {
    type: 'object',
    properties: {
      fileUri: { type: 'string', description: 'Local file:// URI to share' },
      mimeType: { type: 'string', description: 'Optional MIME type for the file' },
      dialogTitle: { type: 'string', description: 'Optional Android/web dialog title' },
      uti: { type: 'string', description: 'Optional iOS Uniform Type Identifier' },
    },
    required: ['fileUri'],
  },
};

export const SHARE_CONTACT_TOOL: ToolDefinition = {
  name: 'share_contact',
  description: 'Share a contact using the native contact share flow.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Contact id to share' },
      message: { type: 'string', description: 'Optional share message' },
    },
    required: ['id'],
  },
};

export const OPEN_URL_TOOL: ToolDefinition = {
  name: 'open_url',
  description:
    'Open a reviewed fallback URL in the default app. Prefer email_compose, sms_compose, phone_call, maps_open, or share tools first.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'Fallback URL with an allowed scheme such as https://, mailto:, tel:, sms:, or geo:',
      },
    },
    required: ['url'],
  },
};

export const NOTIFICATION_SEND_TOOL: ToolDefinition = {
  name: 'notification_send',
  description: 'Send a local notification immediately to the user.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Notification title' },
      body: { type: 'string', description: 'Notification body text' },
    },
    required: ['title', 'body'],
  },
};

export const NOTIFICATION_SCHEDULE_TOOL: ToolDefinition = {
  name: 'notification_schedule',
  description: 'Schedule a local notification after a delay in seconds.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Notification title' },
      body: { type: 'string', description: 'Notification body text' },
      delaySeconds: { type: 'number', description: 'Delay before delivery in seconds' },
    },
    required: ['title', 'body', 'delaySeconds'],
  },
};

// ── Device Status & Info Tools ───────────────────────────────────────────

export const DEVICE_STATUS_TOOL: ToolDefinition = {
  name: 'device_status',
  description:
    'Get current device status: battery level, network connectivity, screen brightness, and volume.',
  input_schema: { type: 'object', properties: {} },
};

export const DEVICE_INFO_TOOL: ToolDefinition = {
  name: 'device_info',
  description:
    'Get device hardware and software info: model, OS version, memory, storage, screen dimensions.',
  input_schema: { type: 'object', properties: {} },
};

export const DEVICE_PERMISSIONS_TOOL: ToolDefinition = {
  name: 'device_permissions',
  description: 'List all app permissions and their current status (granted, denied, undetermined).',
  input_schema: { type: 'object', properties: {} },
};

export const DEVICE_HEALTH_TOOL: ToolDefinition = {
  name: 'device_health',
  description: 'Get device health metrics: memory usage, storage usage, thermal state, uptime.',
  input_schema: { type: 'object', properties: {} },
};

// ── Media Tools ──────────────────────────────────────────────────────────

export const PHOTOS_LATEST_TOOL: ToolDefinition = {
  name: 'photos_latest',
  description: 'Get the most recent photos from the device photo library.',
  input_schema: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of photos to return (default: 5, max: 20)' },
    },
  },
};

export const CAMERA_CLIP_TOOL: ToolDefinition = {
  name: 'camera_clip',
  description: 'Record a short video clip using the device camera.',
  input_schema: {
    type: 'object',
    properties: {
      durationSeconds: { type: 'number', description: 'Max duration in seconds (default: 10)' },
      quality: {
        type: 'string',
        description: 'Video quality: low, medium, high (default: medium)',
      },
      camera: { type: 'string', description: 'Camera: front or back (default: back)' },
    },
  },
};

export const SCREEN_RECORD_TOOL: ToolDefinition = {
  name: 'screen_record',
  description:
    'Take a screenshot of the current app screen and return it as a base64-encoded image.',
  input_schema: {
    type: 'object',
    properties: {
      format: { type: 'string', description: 'Image format: png or jpeg (default: png)' },
    },
  },
};

// ── Haptic Feedback Tool ─────────────────────────────────────────────────

export const HAPTIC_FEEDBACK_TOOL: ToolDefinition = {
  name: 'haptic_feedback',
  description: 'Trigger haptic feedback on the device. Use for confirmations or alerts.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description:
          'Feedback type: light, medium, heavy, success, warning, error (default: medium)',
      },
    },
  },
};

export const ALL_NATIVE_TOOL_DEFINITIONS: ToolDefinition[] = [
  CALENDAR_LIST_TOOL,
  CALENDAR_EVENTS_TOOL,
  CALENDAR_CREATE_TOOL,
  EMAIL_COMPOSE_TOOL,
  SMS_COMPOSE_TOOL,
  PHONE_CALL_TOOL,
  MAPS_OPEN_TOOL,
  CONTACTS_PICK_TOOL,
  CONTACTS_MANAGE_ACCESS_TOOL,
  CONTACTS_VIEW_TOOL,
  CONTACTS_EDIT_TOOL,
  CONTACTS_CREATE_TOOL,
  CONTACTS_SHARE_TOOL,
  CONTACTS_SEARCH_FULL_TOOL,
  CONTACTS_GET_FULL_TOOL,
  LOCATION_CURRENT_TOOL,
  CLIPBOARD_READ_TOOL,
  CLIPBOARD_WRITE_TOOL,
  SHARE_TEXT_TOOL,
  SHARE_URL_TOOL,
  SHARE_FILE_TOOL,
  SHARE_CONTACT_TOOL,
  OPEN_URL_TOOL,
  NOTIFICATION_SEND_TOOL,
  NOTIFICATION_SCHEDULE_TOOL,
  DEVICE_STATUS_TOOL,
  DEVICE_INFO_TOOL,
  DEVICE_PERMISSIONS_TOOL,
  DEVICE_HEALTH_TOOL,
  PHOTOS_LATEST_TOOL,
  CAMERA_CLIP_TOOL,
  SCREEN_RECORD_TOOL,
  HAPTIC_FEEDBACK_TOOL,
];
