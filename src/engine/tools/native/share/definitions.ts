import type { ToolDefinition } from '../../../../types/tool';
import { nativeContract, RECOVERABLE_EXTERNAL_ERRORS } from '../shared';

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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['share_sheet.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
    consumes: [{ kind: 'clipboard_text', required: false }],
  }),
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['share_sheet.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['share_sheet.available', 'file.read'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['contacts.read', 'share_sheet.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS, 'not_found'],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
};

export const SHARE_TOOL: ToolDefinition = {
  name: 'share',
  description:
    'Share content using the native share sheet. ' +
    'Use kind to choose what to share: text, url (http/https URL), file (local file:// URI), or contact (a contact id).',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['text', 'url', 'file', 'contact'],
        description: 'Type of content to share.',
      },
      text: {
        type: 'string',
        description:
          'Plain text payload. Required for kind=text; optional message for url/contact.',
      },
      url: {
        type: 'string',
        description: 'HTTP or HTTPS URL. Required for kind=url.',
      },
      message: {
        type: 'string',
        description: 'Optional message accompanying url or contact share.',
      },
      title: {
        type: 'string',
        description: 'Optional share-sheet title (kind=text or kind=url).',
      },
      fileUri: { type: 'string', description: 'Local file:// URI. Required for kind=file.' },
      mimeType: { type: 'string', description: 'Optional MIME type for kind=file.' },
      dialogTitle: {
        type: 'string',
        description: 'Optional Android/web dialog title for kind=file.',
      },
      uti: { type: 'string', description: 'Optional iOS Uniform Type Identifier for kind=file.' },
      id: { type: 'string', description: 'Contact id. Required for kind=contact.' },
    },
    required: ['kind'],
  },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['share_sheet.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
};
