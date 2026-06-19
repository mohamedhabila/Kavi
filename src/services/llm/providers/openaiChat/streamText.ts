import { isPlainRecord } from '../../core/json';

export type StreamTextExtraction = {
  content: string;
  reasoning: string;
};

export function extractOpenAiCompatibleTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractOpenAiCompatibleTextValue(entry)).join('');
  }

  if (!isPlainRecord(value)) {
    return '';
  }

  if (typeof value.text === 'string') {
    return value.text;
  }
  if (typeof value.output_text === 'string') {
    return value.output_text;
  }
  if (typeof value.refusal === 'string') {
    return value.refusal;
  }
  if (typeof value.reasoning_content === 'string') {
    return value.reasoning_content;
  }

  return '';
}

function extractStructuredStreamTextPart(part: unknown): StreamTextExtraction {
  if (typeof part === 'string') {
    return { content: part, reasoning: '' };
  }

  if (!isPlainRecord(part)) {
    return { content: '', reasoning: '' };
  }

  const type = typeof part.type === 'string' ? part.type : '';
  const text = extractOpenAiCompatibleTextValue(part);

  if (typeof part.reasoning_content === 'string' && part.reasoning_content.length > 0) {
    return { content: '', reasoning: part.reasoning_content };
  }

  if (
    part.thought === true ||
    /^(?:reasoning(?:_summary)?_text|reasoning|thinking|thought)$/.test(type)
  ) {
    return { content: '', reasoning: text };
  }

  if (type === 'refusal') {
    return { content: text, reasoning: '' };
  }

  return { content: text, reasoning: '' };
}

export function extractOpenAiCompatibleStreamText(
  value: unknown,
): StreamTextExtraction {
  if (typeof value === 'string') {
    return { content: value, reasoning: '' };
  }

  if (Array.isArray(value)) {
    let content = '';
    let reasoning = '';

    for (const part of value) {
      const extracted = extractStructuredStreamTextPart(part);
      content += extracted.content;
      reasoning += extracted.reasoning;
    }

    return { content, reasoning };
  }

  return extractStructuredStreamTextPart(value);
}

export function trimGeminiCumulativeText(
  fullContent: string,
  incoming: string,
): string {
  if (!incoming || !fullContent) {
    return incoming;
  }

  return incoming.startsWith(fullContent)
    ? incoming.slice(fullContent.length)
    : incoming;
}
