import { MarkedLexer, useMarkdown } from 'react-native-marked';
import { Tokenizer as MarkedTokenizer } from 'marked';
import {
  buildStreamingPreview as buildSharedStreamingPreview,
  trimRenderableContent,
} from '../../utils/streamingPreview';

export { trimRenderableContent };

export interface ContentSegment {
  type: 'markdown' | 'code';
  content: string;
  language?: string;
}

export interface TruncateResult {
  text: string;
  total: number;
  truncated: boolean;
}

export interface ContentRenderPlan {
  text: string;
  mode: 'markdown' | 'plain';
  truncated: boolean;
}

export type MarkdownTokenizer = NonNullable<Parameters<typeof useMarkdown>[1]>['tokenizer'];

const MARKDOWN_CHAR_LIMIT = 140_000;
const MARKDOWN_PARSE_LIMIT = 40_000;

function truncateText(value: string, maxChars: number): TruncateResult {
  if (value.length <= maxChars) {
    return { text: value, total: value.length, truncated: false };
  }

  return {
    text: value.slice(0, maxChars),
    total: value.length,
    truncated: true,
  };
}

function getMarkdownTruncationSuffix(totalChars: number, shownChars: number): string {
  return `\n\n… truncated (${totalChars} chars, showing first ${shownChars}).`;
}

export function buildContentRenderPlan(content: string): ContentRenderPlan | null {
  const normalizedContent = trimRenderableContent(content);
  if (!normalizedContent) {
    return null;
  }

  const truncated = truncateText(normalizedContent, MARKDOWN_CHAR_LIMIT);
  const text = truncated.truncated
    ? `${truncated.text}${getMarkdownTruncationSuffix(truncated.total, truncated.text.length)}`
    : truncated.text;

  return {
    text,
    mode: text.length > MARKDOWN_PARSE_LIMIT ? 'plain' : 'markdown',
    truncated: truncated.truncated,
  };
}

class SafeMarkdownTokenizer extends MarkedTokenizer {
  override html(_src: string): undefined {
    return undefined;
  }
}

export function createSafeMarkdownTokenizer(): MarkdownTokenizer {
  return new SafeMarkdownTokenizer();
}

function pushMarkdownSegment(segments: ContentSegment[], content: string) {
  if (!content) {
    return;
  }

  segments.push({ type: 'markdown', content });
}

export function splitContentSegments(
  content: string,
  tokenizer?: MarkdownTokenizer,
): ContentSegment[] {
  const normalizedContent = trimRenderableContent(content);
  if (!normalizedContent) {
    return [];
  }

  const segments: ContentSegment[] = [];
  let cursor = 0;

  try {
    const tokens = MarkedLexer(normalizedContent, { gfm: true, tokenizer });

    for (const token of tokens) {
      if (token.type !== 'code' || typeof token.raw !== 'string') {
        continue;
      }

      const tokenStart = normalizedContent.indexOf(token.raw, cursor);
      if (tokenStart < 0) {
        continue;
      }

      if (tokenStart > cursor) {
        pushMarkdownSegment(segments, normalizedContent.slice(cursor, tokenStart));
      }

      segments.push({
        type: 'code',
        language: token.lang?.trim() || undefined,
        content: typeof token.text === 'string' ? token.text.replace(/\n$/, '') : '',
      });
      cursor = tokenStart + token.raw.length;
    }
  } catch {
    return [{ type: 'markdown', content: normalizedContent }];
  }

  if (cursor < normalizedContent.length) {
    pushMarkdownSegment(segments, normalizedContent.slice(cursor));
  }

  return segments.length ? segments : [{ type: 'markdown', content: normalizedContent }];
}

export function buildStreamingPreview(text: string): string {
  return buildSharedStreamingPreview(text);
}
