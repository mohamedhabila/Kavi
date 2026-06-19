import type { ToolDefinition } from '../../../../types/tool';
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
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['mail.compose.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
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
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['sms.compose.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
    consumes: [
      { kind: 'phone_number', required: false },
      { kind: 'contact_candidate', field: 'phoneNumbers', required: false },
    ],
  }),
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['phone.dialer.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
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
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['maps.open.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
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
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['url.open.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
    produces: [{ kind: 'notification_id' }],
    precedes: ['notification_cancel'],
  }),
};
