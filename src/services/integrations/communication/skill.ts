import type { Skill } from '../../skills/types';
import { createApiTool } from '../shared/toolFactory';

export function createCommunicationSkill(): Skill {
  return {
    id: 'communication',
    name: 'Communication',
    description: 'Email drafting and translation helpers',
    version: '2.0.0',
    systemPrompt:
      'You have access to communication tools for drafting emails and translating text.',
    tools: [
      createApiTool(
        'draft_email',
        'Generate a professional email draft',
        {
          to: { type: 'string', description: 'Recipient name or context' },
          subject: { type: 'string', description: 'Email subject' },
          context: { type: 'string', description: 'What the email should be about' },
          tone: { type: 'string', description: '"formal", "casual", "friendly" (default: formal)' },
        },
        ['subject', 'context'],
        async (args) => {
          return JSON.stringify({
            status: 'draft_generated',
            to: args.to || '(recipient)',
            subject: args.subject,
            tone: args.tone || 'formal',
            note: 'The email draft should be composed by the LLM using this context.',
            context: args.context,
          });
        },
      ),
      createApiTool(
        'translate',
        'Translate text between languages',
        {
          text: { type: 'string', description: 'Text to translate' },
          from: { type: 'string', description: 'Source language (auto-detect if omitted)' },
          to: { type: 'string', description: 'Target language' },
        },
        ['text', 'to'],
        async (args) => {
          return JSON.stringify({
            status: 'translate_request',
            text: args.text.slice(0, 5000),
            from: args.from || 'auto',
            to: args.to,
            note: 'The LLM should translate this text inline.',
          });
        },
      ),
    ],
  };
}
