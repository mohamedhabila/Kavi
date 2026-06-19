import type { ToolDefinition } from '../../../../types/tool';
import {
  nativeContract,
  RECOVERABLE_DEVICE_READ_ERRORS,
  RECOVERABLE_PLATFORM_ERRORS,
} from '../shared';

export const PHOTOS_LATEST_TOOL: ToolDefinition = {
  name: 'photos_latest',
  description: 'Get the most recent photos from the device photo library.',
  input_schema: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of photos to return (default: 5, max: 20)' },
    },
  },
  contract: nativeContract({
    category: 'media',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'high',
    permissionPrerequisites: ['media_library.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
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
  contract: nativeContract({
    category: 'media',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'critical',
    permissionPrerequisites: ['camera.record_video'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
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
  contract: nativeContract({
    category: 'media',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'critical',
    permissionPrerequisites: ['screen.capture'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  }),
};
