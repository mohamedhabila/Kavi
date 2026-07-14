import { generateId } from '../../utils/id';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

export async function executePollCreate(args: {
  question: string;
  options: string[];
  allowMultiple?: boolean;
  durationMs?: number;
}): Promise<ToolRuntimeOutcome> {
  const normalizedOptions = (args.options || [])
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((label) => ({ id: generateId(), label, votes: 0 }));

  if (!args.question?.trim()) {
    return failedToolOutcome(
      JSON.stringify({ status: 'error', error: 'Poll question is required' }),
    );
  }

  if (normalizedOptions.length < 2) {
    return failedToolOutcome(
      JSON.stringify({ status: 'error', error: 'At least two poll options are required' }),
    );
  }

  return completedToolOutcome(
    JSON.stringify({
      status: 'created',
      poll: {
        id: generateId(),
        question: args.question.trim(),
        options: normalizedOptions,
        allowMultiple: args.allowMultiple === true,
        durationMs: args.durationMs,
        createdAt: Date.now(),
      },
    }),
  );
}

export async function executeMessageEffect(args: {
  effectId: string;
}): Promise<ToolRuntimeOutcome> {
  const effectId = (args.effectId || '').trim().toLowerCase();
  if (!['confetti', 'balloons', 'spotlight'].includes(effectId)) {
    return failedToolOutcome(
      JSON.stringify({
        status: 'error',
        error: 'Unsupported effect. Use confetti, balloons, or spotlight.',
      }),
    );
  }

  return completedToolOutcome(JSON.stringify({ status: 'applied', effectId }));
}
