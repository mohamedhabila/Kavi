// ---------------------------------------------------------------------------
// Kavi — Tool Argument JSON Recovery
// ---------------------------------------------------------------------------
// Recovers the one malformed shape models emit for array-of-object parameters:
// the inner object braces are dropped, leaving bare key/value pairs as array
// elements.
//
//   {"path": "r.md", "edits": ["op": "replace", "oldText": "a"]}      <- emitted
//   {"path": "r.md", "edits": [{"op": "replace", "oldText": "a"}]}    <- meant
//
// Traced live on an Android emulator across several runs and two unrelated
// tools — file_edit.edits and update_goals.goals — always with the same shape.
// The cause is not the tool contracts, which are correct, but constrained
// decoding never being switched on: the provider adapter gates OpenAI strict
// function calling on isOpenAIProvider(), so a run served through OpenRouter
// silently drops the `strict: true` a tool declared and the model free-generates
// its arguments. Without the decoder holding it to the schema, this model loses
// the braces essentially every time it fills an array of objects.
//
// A JSON array element that begins with `"key":` is not ambiguous — an array
// element can never be a bare key/value pair, so the only reading is a dropped
// `{`. Recovery is therefore deterministic rather than a guess, and it runs only
// after JSON.parse has already failed, so well-formed arguments are never
// touched.
// ---------------------------------------------------------------------------

interface ArrayFrame {
  kind: 'array';
  /** Whether this array is currently standing in for an object we opened. */
  syntheticOpen: boolean;
  /** Keys already used by the synthetic object, to detect the next element. */
  seenKeys: Set<string>;
}

interface ObjectFrame {
  kind: 'object';
}

type Frame = ArrayFrame | ObjectFrame;

interface StringToken {
  /** Decoded value, used for key comparison. */
  value: string;
  /** Index just past the closing quote. */
  end: number;
}

function readStringToken(text: string, start: number): StringToken | null {
  if (text[start] !== '"') {
    return null;
  }

  let index = start + 1;
  let value = '';

  while (index < text.length) {
    const char = text[index];

    if (char === '\\') {
      // Keep the escape verbatim; only its literal identity matters for a key.
      value += text.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char === '"') {
      return { value, end: index + 1 };
    }

    value += char;
    index += 1;
  }

  return null;
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index])) {
    index += 1;
  }
  return index;
}

/**
 * The key name when `text` at `start` reads as `"key":`, otherwise null.
 *
 * This is the whole discriminator. Inside an array, a string followed by a
 * colon cannot be a legal element, so seeing one means the element's opening
 * brace was dropped.
 */
function peekBareKey(text: string, start: number): string | null {
  const index = skipWhitespace(text, start);
  const token = readStringToken(text, index);
  if (!token) {
    return null;
  }
  return text[skipWhitespace(text, token.end)] === ':' ? token.value : null;
}

/**
 * Reinserts object braces dropped inside arrays. Returns the text unchanged when
 * there is nothing of that shape to repair.
 */
export function recoverDroppedObjectBraces(text: string): string {
  let out = '';
  let index = 0;
  let repaired = false;
  const stack: Frame[] = [];

  const topArrayFrame = (): ArrayFrame | null => {
    const top = stack[stack.length - 1];
    return top?.kind === 'array' ? top : null;
  };

  while (index < text.length) {
    const char = text[index];

    if (char === '"') {
      const token = readStringToken(text, index);
      if (!token) {
        // Unterminated string: nothing further can be recovered safely.
        return repaired ? out + text.slice(index) : text;
      }

      out += text.slice(index, token.end);
      index = token.end;

      const frame = topArrayFrame();
      if (frame?.syntheticOpen && text[skipWhitespace(text, index)] === ':') {
        frame.seenKeys.add(token.value);
      }
      continue;
    }

    if (char === '[') {
      const frame: ArrayFrame = { kind: 'array', syntheticOpen: false, seenKeys: new Set() };
      out += char;
      index += 1;

      if (peekBareKey(text, index) !== null) {
        out += '{';
        frame.syntheticOpen = true;
        repaired = true;
      }

      stack.push(frame);
      continue;
    }

    if (char === '{') {
      stack.push({ kind: 'object' });
      out += char;
      index += 1;
      continue;
    }

    if (char === ']') {
      const frame = topArrayFrame();
      if (frame?.syntheticOpen) {
        out += '}';
      }
      stack.pop();
      out += char;
      index += 1;
      continue;
    }

    if (char === '}') {
      stack.pop();
      out += char;
      index += 1;
      continue;
    }

    if (char === ',') {
      /**
       * A separator with nothing before it, or nothing after it, separates nothing.
       *
       * Traced on-device alongside the dropped braces: a run opened a call with
       * `{, "goals": [...]` and was answered "Expect a string key in JSON object". Both
       * malformations come from the same cause — constrained decoding is off, so the
       * model writes JSON freehand — and both have exactly one reading.
       */
      const previous = out.trimEnd().slice(-1);
      const nextChar = text[skipWhitespace(text, index + 1)];
      if (previous === '{' || previous === '[' || nextChar === '}' || nextChar === ']') {
        repaired = true;
        index += 1;
        continue;
      }

      const frame = topArrayFrame();
      if (frame?.syntheticOpen) {
        const nextKey = peekBareKey(text, index + 1);
        // A key repeating inside one object is illegal, so it opens the next
        // element — this is how several flattened objects are separated again.
        if (nextKey !== null && frame.seenKeys.has(nextKey)) {
          out += '},{';
          frame.seenKeys.clear();
          index += 1;
          continue;
        }
      }

      out += char;
      index += 1;
      continue;
    }

    out += char;
    index += 1;
  }

  return repaired ? out : text;
}

/**
 * Parses tool-call arguments, recovering the dropped-brace shape when the raw
 * text does not parse. Throws the original SyntaxError when recovery does not
 * yield valid JSON, so genuinely malformed calls still surface as malformed.
 */
export function parseToolArgumentsJson(argsString: string): unknown {
  if (!argsString) {
    return {};
  }

  try {
    return JSON.parse(argsString);
  } catch (originalError) {
    const recovered = recoverDroppedObjectBraces(argsString);
    if (recovered === argsString) {
      throw originalError;
    }

    try {
      return JSON.parse(recovered);
    } catch {
      throw originalError;
    }
  }
}
