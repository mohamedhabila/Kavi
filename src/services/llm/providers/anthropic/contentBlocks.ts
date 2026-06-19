import { isPlainRecord, safeJsonParse } from '../../core/json';
import { readTrimmedString } from '../../core/toolCallNormalization';

export function stringifyAnthropicContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function anthropicContentIsEmpty(content: string | any[]): boolean {
  if (typeof content === 'string') {
    return content.length === 0;
  }
  return content.length === 0;
}

export function anthropicContentToBlocks(content: string | any[]): any[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }

  return content.filter((block) => {
    if (!isPlainRecord(block)) {
      return true;
    }
    if (block.type !== 'text') {
      return true;
    }
    return typeof block.text === 'string' && block.text.length > 0;
  });
}

export function orderAnthropicUserBlocks(blocks: any[]): any[] {
  if (blocks.length === 0) {
    return blocks;
  }

  const toolResults: any[] = [];
  const otherBlocks: any[] = [];

  for (const block of blocks) {
    if (isPlainRecord(block) && block.type === 'tool_result') {
      toolResults.push(block);
    } else {
      otherBlocks.push(block);
    }
  }

  return toolResults.length > 0
    ? mergeAnthropicToolResultsById([...toolResults, ...otherBlocks])
    : otherBlocks;
}

export function mergeAnthropicContent(
  existing: string | any[],
  incoming: string | any[],
): string | any[] {
  if (typeof existing === 'string' && typeof incoming === 'string') {
    return existing.length > 0 && incoming.length > 0
      ? `${existing}\n\n${incoming}`
      : `${existing}${incoming}`;
  }

  const mergedBlocks = orderAnthropicUserBlocks([
    ...anthropicContentToBlocks(existing),
    ...anthropicContentToBlocks(incoming),
  ]);

  if (mergedBlocks.length === 0) {
    return '';
  }

  return mergedBlocks.length === 1 && mergedBlocks[0]?.type === 'text'
    ? mergedBlocks[0].text
    : mergedBlocks;
}

export function mergeAnthropicToolResultsById(blocks: any[]): any[] {
  const ordered: any[] = [];
  const indexByToolUseId = new Map<string, number>();

  for (const block of blocks) {
    if (!isPlainRecord(block) || block.type !== 'tool_result') {
      ordered.push(block);
      continue;
    }

    const toolUseId = readTrimmedString(block.tool_use_id) ?? '';
    const existingIndex = toolUseId ? indexByToolUseId.get(toolUseId) : undefined;
    if (!toolUseId || existingIndex === undefined) {
      if (toolUseId) {
        indexByToolUseId.set(toolUseId, ordered.length);
      }
      ordered.push({ ...block });
      continue;
    }

    const existing = ordered[existingIndex] as Record<string, any>;
    const existingContent = stringifyAnthropicContent(existing.content);
    const nextContent = stringifyAnthropicContent(block.content);
    existing.content =
      existingContent && nextContent
        ? `${existingContent}\n\n${nextContent}`
        : `${existingContent}${nextContent}`;
    if (block.is_error === true) {
      existing.is_error = true;
    }
  }

  return ordered;
}

export function mergeAnthropicAssistantContent(
  existing: string | any[],
  incoming: string | any[],
): string | any[] {
  const mergedBlocks = [
    ...anthropicContentToBlocks(existing),
    ...anthropicContentToBlocks(incoming),
  ];

  if (mergedBlocks.length === 0) {
    return '';
  }

  return mergedBlocks.length === 1 && mergedBlocks[0]?.type === 'text'
    ? mergedBlocks[0].text
    : mergedBlocks;
}

function parseAnthropicImageDataUrl(value: unknown): { mediaType: string; data: string } | null {
  const url =
    typeof value === 'string'
      ? value
      : isPlainRecord(value) && typeof value.url === 'string'
        ? value.url
        : '';

  if (!url) {
    return null;
  }

  const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const mediaType = match[1].trim().toLowerCase();
  if (!mediaType.startsWith('image/')) {
    return null;
  }

  return {
    mediaType,
    data: match[2].replace(/\s+/g, ''),
  };
}

export function normalizeAnthropicAssistantBlock(block: unknown): Record<string, any> | null {
  if (typeof block === 'string') {
    const text = stringifyAnthropicContent(block);
    return text.length > 0 ? { type: 'text', text } : null;
  }

  if (!isPlainRecord(block)) {
    return null;
  }

  if (block.type === 'text') {
    const text = stringifyAnthropicContent(block.text);
    return text.length > 0 ? { type: 'text', text } : null;
  }

  if (block.type === 'thinking') {
    const normalized: Record<string, any> = {
      type: 'thinking',
      thinking: typeof block.thinking === 'string' ? block.thinking : '',
    };
    if (typeof block.signature === 'string' && block.signature.length > 0) {
      normalized.signature = block.signature;
    }
    return normalized;
  }

  if (block.type === 'redacted_thinking') {
    const data = typeof block.data === 'string' ? block.data : '';
    return data.length > 0 ? { type: 'redacted_thinking', data } : null;
  }

  if (block.type === 'tool_use') {
    const id = readTrimmedString(block.id) ?? '';
    const name = readTrimmedString(block.name) ?? '';
    if (!id || !name) {
      return null;
    }

    const input = isPlainRecord(block.input) ? block.input : safeJsonParse(block.input);

    return {
      type: 'tool_use',
      id,
      name,
      input: isPlainRecord(input) ? input : {},
    };
  }

  return typeof block.type === 'string' && block.type.length > 0 ? { ...block } : null;
}

export function normalizeAnthropicUserContent(content: unknown): string | any[] {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return stringifyAnthropicContent(content);
  }

  const blocks: any[] = [];

  const pushText = (value: unknown) => {
    const text = stringifyAnthropicContent(value);
    if (text.length > 0) {
      blocks.push({ type: 'text', text });
    }
  };

  for (const block of content) {
    if (typeof block === 'string') {
      pushText(block);
      continue;
    }

    if (!isPlainRecord(block)) {
      continue;
    }

    if (block.type === 'text' || block.type === 'input_text') {
      pushText(block.text);
      continue;
    }

    if (block.type === 'tool_result') {
      const toolUseId = readTrimmedString(block.tool_use_id) ?? '';
      if (!toolUseId) {
        continue;
      }

      const normalizedBlock: Record<string, any> = {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: stringifyAnthropicContent(block.content),
      };
      if (block.is_error === true) {
        normalizedBlock.is_error = true;
      }
      blocks.push(normalizedBlock);
      continue;
    }

    if (block.type === 'image') {
      blocks.push(block);
      continue;
    }

    if (block.type === 'image_url' || block.type === 'input_image') {
      const parsed = parseAnthropicImageDataUrl(block.image_url);
      if (!parsed) {
        continue;
      }

      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType,
          data: parsed.data,
        },
      });
    }
  }

  const orderedBlocks = orderAnthropicUserBlocks(blocks);

  if (orderedBlocks.length === 0) {
    return '';
  }

  return orderedBlocks.length === 1 && orderedBlocks[0]?.type === 'text'
    ? orderedBlocks[0].text
    : orderedBlocks;
}
