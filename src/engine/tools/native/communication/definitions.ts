import type { ToolDefinition } from '../../../../types/tool';
import { SMS_SEND_MAX_MESSAGE_LENGTH } from '../../../../services/nativeActions/types';
import { nativeContract, RECOVERABLE_EXTERNAL_ERRORS } from '../shared';

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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['mail.compose.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
    consumes: [
      { kind: 'phone_number', required: false },
      { kind: 'contact_candidate', field: 'phoneNumbers', required: false },
    ],
  }),
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['sms.compose.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
    consumes: [
      { kind: 'phone_number', required: false },
      { kind: 'contact_candidate', field: 'phoneNumbers', required: false },
    ],
  }),
};

export const SMS_SEND_TOOL: ToolDefinition = {
  name: 'sms_send',
  description:
    'Send a text message for the person; it goes out as soon as they approve. On Android Kavi ' +
    'sends it itself while it is the default assistant; otherwise, and on iOS, the composer ' +
    'opens with the message ready and the result says so. Use sms_compose instead for a draft ' +
    'the person wants to edit or send themselves, or for attachments.',
  input_schema: {
    type: 'object',
    properties: {
      recipients: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description: 'Recipient phone numbers',
      },
      message: {
        type: 'string',
        minLength: 1,
        maxLength: SMS_SEND_MAX_MESSAGE_LENGTH,
        description: 'The text, written as the person would send it',
      },
      defaultCountry: {
        type: 'string',
        description: 'Optional two-letter ISO country code for local phone number parsing',
      },
    },
    required: ['recipients', 'message'],
  },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['sms.compose.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
    consumes: [
      { kind: 'phone_number', required: false },
      { kind: 'contact_candidate', field: 'phoneNumbers', required: false },
    ],
  }),
};

export const PHONE_CALL_TOOL: ToolDefinition = {
  name: 'phone_call',
  description:
    'Call a phone number for the person; use this instead of open_url with tel:. On Android ' +
    'the call starts as soon as they approve (emergency numbers, and calls without the call ' +
    'permission, open the dialer instead); on iOS the system asks them to confirm.',
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['phone.dialer.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
  }),
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['maps.open.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
    consumes: [
      { kind: 'location', required: false },
      { kind: 'place_query', required: false },
    ],
  }),
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['url.open.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
  }),
};
