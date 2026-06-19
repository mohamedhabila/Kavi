import { ToolDefinition } from '../../types/tool';

export const WAIT_TOOL: ToolDefinition = {
  name: 'wait',
  description:
    'Pause briefly before the next tool call. Useful when polling long-running workflows or sub-agent sessions.',
  input_schema: {
    type: 'object',
    properties: {
      ms: {
        type: 'number',
        description: 'Delay in milliseconds, clamped to 100-60000 (default: 1000)',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for the wait, echoed back in the result',
      },
    },
    required: [],
  },
  contract: {
    category: 'async_wait',
    capabilities: ['wait'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: [],
    workflowStages: ['await_external_execution'],
  },
};

export const PDF_READ_TOOL: ToolDefinition = {
  name: 'pdf_read',
  description: 'Extract text content from a PDF file. Reads PDFs from workspace or a URL.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'PDF file path (relative to workspace) or URL' },
      pages: { type: 'string', description: 'Page range, e.g. "1-5" or "all" (default: all)' },
    },
    required: ['path'],
  },
  contract: {
    category: 'pdf',
    capabilities: ['read', 'verify'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  },
};

export const CAMERA_SNAP_TOOL: ToolDefinition = {
  name: 'camera_snap',
  description: 'Take a photo using the device camera and return it as a base64-encoded image.',
  input_schema: {
    type: 'object',
    properties: {
      camera: {
        type: 'string',
        description: 'Camera to use: "front" or "back" (default: back)',
      },
      quality: {
        type: 'number',
        description: 'Image quality 0-1 (default: 0.7)',
      },
    },
    required: [],
  },
  contract: {
    category: 'device_media',
    capabilities: ['read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource'],
  },
};

export const AUDIO_TRANSCRIBE_TOOL: ToolDefinition = {
  name: 'audio_transcribe',
  description:
    'Record audio from the microphone for a specified duration, then transcribe the recording to text using Whisper API.',
  input_schema: {
    type: 'object',
    properties: {
      durationMs: {
        type: 'number',
        description: 'Recording duration in milliseconds (default: 5000)',
      },
      language: {
        type: 'string',
        description: 'Expected language code, e.g. "en" (optional)',
      },
    },
    required: [],
  },
  contract: {
    category: 'device_media',
    capabilities: ['read', 'compute'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  },
};

export const BUILTIN_UTILITY_TOOL_DEFINITIONS: ToolDefinition[] = [
  WAIT_TOOL,
  PDF_READ_TOOL,
  CAMERA_SNAP_TOOL,
  AUDIO_TRANSCRIBE_TOOL,
];
