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
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['share_sheet.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
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
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['share_sheet.available'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
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
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    permissionPrerequisites: ['share_sheet.available', 'file.read'],
    recoverableErrors: [...RECOVERABLE_EXTERNAL_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
  }),
};
