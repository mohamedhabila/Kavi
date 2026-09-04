import type { Skill } from '../../skills/types';
import { createApiTool } from '../shared/toolFactory';

export function createMediaSkill(): Skill {
  return {
    id: 'media',
    name: 'Media',
    description: 'QR code generation.',
    version: '2.0.0',
    tools: [
      createApiTool(
        'generate_qr',
        'Generate a QR code for a given text or URL',
        {
          data: { type: 'string', description: 'Data to encode in the QR code' },
          size: { type: 'number', description: 'Image size in pixels (default: 256)' },
        },
        ['data'],
        async (args) => {
          const size = args.size || 256;
          const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(args.data)}`;
          return JSON.stringify({ status: 'generated', url, data: args.data, size });
        },
      ),
    ],
  };
}
