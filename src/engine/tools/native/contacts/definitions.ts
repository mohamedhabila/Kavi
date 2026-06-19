import type { ToolDefinition } from '../../../../types/tool';
import {
  nativeContract,
  RECOVERABLE_DEVICE_READ_ERRORS,
  RECOVERABLE_EXTERNAL_ERRORS,
  RECOVERABLE_PLATFORM_ERRORS,
} from '../shared';
import { CONTACT_MUTATION_PROPERTIES } from './schema';

export const CONTACTS_PICK_TOOL: ToolDefinition = {
  name: 'contacts_pick',
  description: 'Open the native contact picker and return a single selected contact preview.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: ['contacts.pick'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
};

export const CONTACTS_MANAGE_ACCESS_TOOL: ToolDefinition = {
  name: 'contacts_manage_access',
  description:
    'On iOS limited-contact access, open the native picker so the user can grant this app access to additional contacts.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: ['contacts.limited_access.manage'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
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
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: ['contacts.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS, 'not_found'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
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
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['contacts.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS, 'not_found'],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
};

export const CONTACTS_CREATE_TOOL: ToolDefinition = {
  name: 'contacts_create',
  description: 'Open the native create-contact form, optionally prefilled with initial values.',
  input_schema: {
    type: 'object',
    properties: CONTACT_MUTATION_PROPERTIES,
  },
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['contacts.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
};

export const CONTACTS_FORM_TOOL: ToolDefinition = {
  name: 'contacts_form',
  description:
    'Open the native contacts UI for a single contact. ' +
    'Use action to choose: view (read-only), edit (modify an existing contact, optionally prefilled), or create (new contact form, optionally prefilled).',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['view', 'edit', 'create'],
        description: 'Form action to launch.',
      },
      id: {
        type: 'string',
        description: 'Contact id. Required for action=view and action=edit.',
      },
      ...CONTACT_MUTATION_PROPERTIES,
    },
    required: ['action'],
  },
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['contacts.read', 'contacts.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS, 'not_found'],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
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
  contract: nativeContract({
    category: 'contacts',
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

export const CONTACTS_SEARCH_TOOL: ToolDefinition = {
  name: 'contacts_search',
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
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['discover', 'read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'high',
    permissionPrerequisites: ['contacts.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'inspect_resource'],
    produces: [{ kind: 'contact_candidate' }],
  }),
};

export const CONTACTS_GET_TOOL: ToolDefinition = {
  name: 'contacts_get',
  description: 'Get full contact details for a specific contact id using full contacts permission.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Contact id' },
    },
    required: ['id'],
  },
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'high',
    permissionPrerequisites: ['contacts.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS, 'not_found'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    consumes: [{ kind: 'contact_candidate' }],
    produces: [{ kind: 'contact_detail' }],
  }),
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
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['discover', 'read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'high',
    permissionPrerequisites: ['contacts.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'inspect_resource'],
    produces: [{ kind: 'contact_candidate' }],
  }),
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
  contract: nativeContract({
    category: 'contacts',
    capabilities: ['read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'high',
    permissionPrerequisites: ['contacts.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS, 'not_found'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    consumes: [{ kind: 'contact_candidate' }],
    produces: [{ kind: 'contact_detail' }],
  }),
};
