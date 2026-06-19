import type { Skill } from '../../skills/types';
import { createApiTool } from '../shared/toolFactory';

export function createMediaSkill(): Skill {
  return {
    id: 'media',
    name: 'Media',
    description: 'Image-description prompts, QR code generation, and color palette helpers',
    version: '2.0.0',
    tools: [
      createApiTool(
        'describe_image',
        'Describe an image from a URL using vision',
        {
          url: { type: 'string', description: 'Image URL' },
          detail: { type: 'string', description: '"brief" or "detailed" (default: brief)' },
        },
        ['url'],
        async (args) => {
          return JSON.stringify({
            status: 'describe_request',
            url: args.url,
            detail: args.detail || 'brief',
            note: 'Use the vision model to describe this image.',
          });
        },
      ),
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
      createApiTool(
        'color_palette',
        'Generate a color palette',
        {
          count: { type: 'number', description: 'Number of colors (default: 5)' },
          theme: { type: 'string', description: 'Theme or mood for the palette (optional)' },
        },
        [],
        async (args) => {
          return JSON.stringify({
            status: 'palette_request',
            count: args.count || 5,
            theme: args.theme || 'harmonious',
            note: 'The LLM should generate a color palette based on the theme.',
          });
        },
      ),
    ],
  };
}
