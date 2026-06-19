import type { ToolDefinition } from '../../../../types/tool';
import {
  nativeContract,
  RECOVERABLE_DEVICE_READ_ERRORS,
  RECOVERABLE_PLATFORM_ERRORS,
} from '../shared';

export const CLIPBOARD_READ_TOOL: ToolDefinition = {
  name: 'clipboard_read',
  description: 'Read the current text from the system clipboard.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'high',
    permissionPrerequisites: ['clipboard.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    consumes: [{ kind: 'clipboard_text' }],
    produces: [{ kind: 'clipboard_text' }],
  }),
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
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'medium',
    permissionPrerequisites: ['clipboard.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
    produces: [{ kind: 'clipboard_text' }],
    precedes: ['clipboard_read'],
  }),
};

export const CLIPBOARD_TOOL: ToolDefinition = {
  name: 'clipboard',
  description: 'Read text from or write text to the system clipboard.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: 'Clipboard action to perform.',
      },
      text: {
        type: 'string',
        description: 'Text to copy to the clipboard. Required for action=write.',
      },
    },
    required: ['action'],
  },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['read', 'write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['clipboard.read', 'clipboard.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
    produces: [{ kind: 'clipboard_text' }],
  }),
};
