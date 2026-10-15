// ---------------------------------------------------------------------------
// Kavi — Spoken Reply
// ---------------------------------------------------------------------------
// Speaks a reply while it is still being written: each complete sentence as soon as it has
// streamed in, so the person hears the answer start instead of waiting for all of it.
// Markdown is read as the text it renders to; code blocks are not read aloud.

import { marked } from 'marked';
import { createLogger } from '../../utils/logger';

const logger = createLogger('SpokenReply');

type MarkdownToken = Readonly<{
  type: string;
  text?: string;
  tokens?: readonly MarkdownToken[];
  items?: readonly MarkdownToken[];
  header?: readonly Readonly<{ tokens: readonly MarkdownToken[] }>[];
  rows?: readonly (readonly Readonly<{ tokens: readonly MarkdownToken[] }>[])[];
}>;

/** Characters that end a sentence, in the scripts Kavi speaks. */
const SENTENCE_END_CHARACTERS = '.!?…。！？؟।॥';
/** Ones that end a sentence even with no space after them (CJK runs without spaces). */
const SPACELESS_SENTENCE_END_CHARACTERS = '。！？';

function spokenTextOfTokens(tokens: readonly MarkdownToken[]): string {
  return tokens.map(spokenTextOfToken).join('');
}

function spokenTextOfCells(cells: readonly Readonly<{ tokens: readonly MarkdownToken[] }>[]) {
  return cells.map((cell) => spokenTextOfTokens(cell.tokens)).join(', ');
}

function spokenTextOfToken(token: MarkdownToken): string {
  switch (token.type) {
    case 'code':
    case 'html':
      return '';
    case 'space':
    case 'hr':
      return '\n';
    case 'br':
      return ' ';
    case 'list':
      return (token.items ?? []).map((item) => `${spokenTextOfToken(item).trim()}\n`).join('');
    case 'table':
      return [token.header ?? [], ...(token.rows ?? [])]
        .map((cells) => `${spokenTextOfCells(cells)}\n`)
        .join('');
    case 'heading':
    case 'paragraph':
    case 'blockquote':
      return `${spokenTextOfTokens(token.tokens ?? [])}\n`;
    default:
      return token.tokens ? spokenTextOfTokens(token.tokens) : (token.text ?? '');
  }
}

/** The words a reply's markdown reads as, with code blocks left out. */
export function toSpokenText(markdown: string): string {
  try {
    const tokens = marked.lexer(markdown, { gfm: true }) as unknown as MarkdownToken[];
    return spokenTextOfTokens(tokens);
  } catch {
    return markdown;
  }
}

/**
 * Where the last complete sentence in `text` ends, or 0 when none has ended yet. A line
 * break ends one only once text follows it: every block of markdown reads as ending in
 * one, including the block still being written.
 */
function lastSentenceEnd(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === '\n') {
      if (text.slice(index + 1).trim()) return index + 1;
      continue;
    }
    if (SPACELESS_SENTENCE_END_CHARACTERS.includes(character)) return index + 1;
    if (
      SENTENCE_END_CHARACTERS.includes(character) &&
      index + 1 < text.length &&
      /\s/u.test(text[index + 1])
    ) {
      return index + 1;
    }
  }
  return 0;
}

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const endsHere =
      character === '\n' ||
      SPACELESS_SENTENCE_END_CHARACTERS.includes(character) ||
      (SENTENCE_END_CHARACTERS.includes(character) &&
        (index + 1 === text.length || /\s/u.test(text[index + 1])));
    if (!endsHere) continue;
    sentences.push(text.slice(start, index + 1));
    start = index + 1;
  }
  sentences.push(text.slice(start));
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

export type SpokenReply = Readonly<{
  /** The reply's whole text so far (markdown); sentences that are complete get spoken. */
  update: (replySoFar: string) => void;
  /** The reply is complete: speak the rest, and resolve once all of it was spoken or stopped. */
  finish: (reply: string) => Promise<void>;
  /** Stop speaking now and drop what is left. */
  stop: () => void;
}>;

export function createSpokenReply(audio: {
  speak: (sentence: string) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  /** Everything that has arrived was spoken, and more of the reply is still to come. */
  onQuiet?: () => void;
}): SpokenReply {
  const queue: string[] = [];
  let queuedText = '';
  let speaking = false;
  let stopped = false;
  let finishing = false;
  let failure: unknown = null;
  let drained: (() => void) | null = null;

  const settleIfDrained = () => {
    if (speaking || (queue.length > 0 && !stopped)) return;
    drained?.();
    drained = null;
  };

  const pump = async () => {
    if (speaking) return;
    speaking = true;
    while (queue.length > 0 && !stopped) {
      const sentence = queue.shift() as string;
      try {
        await audio.speak(sentence);
      } catch (error) {
        failure = error;
        stopped = true;
      }
    }
    speaking = false;
    if (!stopped && !finishing) audio.onQuiet?.();
    settleIfDrained();
  };

  const enqueue = (reply: string, includeUnfinishedSentence: boolean) => {
    if (stopped) return;
    const spoken = toSpokenText(reply);
    // Streamed text only grows; if the finished reply reads differently, carry on from
    // where the two still agree.
    const alreadyQueued = commonPrefixLength(spoken, queuedText);
    const pending = spoken.slice(alreadyQueued);
    const end = includeUnfinishedSentence ? pending.length : lastSentenceEnd(pending);
    if (end === 0) return;
    queue.push(...splitSentences(pending.slice(0, end)));
    queuedText = spoken.slice(0, alreadyQueued + end);
    void pump();
  };

  return {
    update: (replySoFar) => enqueue(replySoFar, false),
    finish: (reply) => {
      finishing = true;
      enqueue(reply, true);
      return new Promise<void>((resolve, reject) => {
        drained = () => (failure ? reject(failure) : resolve());
        settleIfDrained();
      });
    },
    stop: () => {
      stopped = true;
      queue.length = 0;
      if (speaking) {
        audio.stopSpeaking().catch((error: unknown) => {
          logger.warn('Could not stop speaking the reply.', { error: String(error) });
        });
      }
      settleIfDrained();
    },
  };
}
