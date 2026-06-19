export function normalizeJavaScriptSource(code: unknown): string {
  if (typeof code !== 'string') {
    return '';
  }

  let normalized = code.replace(/\r\n/g, '\n').trim();
  const fencedMatch = normalized.match(
    /^```(?:javascript|js|typescript|ts|jsx|tsx)?\s*\n([\s\S]*?)\n```$/i,
  );
  if (fencedMatch) {
    normalized = fencedMatch[1].trim();
  }

  return normalized;
}

export function buildJavaScriptCandidates(code: unknown): string[] {
  const trimmed = normalizeJavaScriptSource(code);
  if (!trimmed) {
    return ["'use strict'; return undefined;"];
  }

  const candidates: string[] = [];
  candidates.push(`'use strict';\nreturn (\n${trimmed}\n);`);

  const lines = trimmed.split('\n');
  let lastLineIndex = lines.length - 1;
  while (lastLineIndex >= 0 && !lines[lastLineIndex].trim()) {
    lastLineIndex -= 1;
  }

  if (lastLineIndex >= 0) {
    const lastLine = lines[lastLineIndex].trim();
    if (isReturnableExpression(lastLine)) {
      const prefix = lines.slice(0, lastLineIndex).join('\n');
      const expression = stripTrailingSemicolon(lastLine);
      candidates.push(`'use strict';\n${prefix}${prefix ? '\n' : ''}return (${expression});`);
    }
  }

  candidates.push(`'use strict';\n${trimmed}`);

  return Array.from(new Set(candidates));
}

export function formatJavaScriptResult(value: unknown): string {
  return serializeJavaScriptValue(value, new WeakSet<object>());
}

export function executeJavaScriptWithResult(code: unknown): unknown {
  const logs: string[] = [];
  const fakeConsole = {
    log: (...args: unknown[]) => {
      logs.push(formatConsoleArguments(args));
    },
    warn: (...args: unknown[]) => {
      logs.push(`[warn] ${formatConsoleArguments(args)}`);
    },
    error: (...args: unknown[]) => {
      logs.push(`[error] ${formatConsoleArguments(args)}`);
    },
    info: (...args: unknown[]) => {
      logs.push(formatConsoleArguments(args));
    },
    debug: (...args: unknown[]) => {
      logs.push(formatConsoleArguments(args));
    },
  };

  let lastError: unknown;

  for (const candidate of buildJavaScriptCandidates(code)) {
    try {
      // Dynamic execution is intentional for the local JavaScript utility surface.
      // It runs explicit user/tool-provided snippets in the app JS runtime, not a
      // security sandbox; callers must treat it as trusted-by-user code.
      const fn = new Function('console', candidate);
      const result = fn(fakeConsole);
      if (result !== undefined) {
        if (logs.length > 0) {
          return `${logs.join('\n')}\n${formatJavaScriptResult(result)}`;
        }
        return result;
      }
      if (logs.length > 0) {
        return logs.join('\n');
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  // If all candidates failed but we captured some console output, return it
  if (logs.length > 0) {
    return logs.join('\n');
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('Unable to execute JavaScript');
}

function formatConsoleArguments(args: unknown[]): string {
  return args.map((arg) => formatJavaScriptResult(arg)).join(' ');
}

function serializeJavaScriptValue(value: unknown, seen: WeakSet<object>): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  const valueType = typeof value;
  if (valueType === 'string') return value as string;
  if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint')
    return String(value);
  if (valueType === 'symbol') return String(value);
  if (valueType === 'function') {
    return `[Function${(value as Function).name ? `: ${(value as Function).name}` : ''}]`;
  }

  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  if (typeof value === 'object') {
    return serializeStructuredValue(value, seen);
  }

  return String(value);
}

function serializeStructuredValue(value: unknown, seen: WeakSet<object>): string {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(([key, entryValue]) => [
      serializeJsonLikeValue(key, seen),
      serializeJsonLikeValue(entryValue, seen),
    ]);
    return JSON.stringify({ type: 'Map', entries }, null, 2);
  }
  if (value instanceof Set) {
    const values = Array.from(value.values()).map((entryValue) =>
      serializeJsonLikeValue(entryValue, seen),
    );
    return JSON.stringify({ type: 'Set', values }, null, 2);
  }

  const jsonLikeValue = serializeJsonLikeValue(value, seen);
  if (typeof jsonLikeValue === 'string') return jsonLikeValue;
  return JSON.stringify(jsonLikeValue, null, 2);
}

function serializeJsonLikeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === undefined) return '[undefined]';
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
  if (typeof value === 'function') {
    return `[Function${value.name ? `: ${value.name}` : ''}]`;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Map) {
    return {
      type: 'Map',
      entries: Array.from(value.entries()).map(([key, entryValue]) => [
        serializeJsonLikeValue(key, seen),
        serializeJsonLikeValue(entryValue, seen),
      ]),
    };
  }
  if (value instanceof Set) {
    return {
      type: 'Set',
      values: Array.from(value.values()).map((entryValue) =>
        serializeJsonLikeValue(entryValue, seen),
      ),
    };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    try {
      return value.map((entryValue) => serializeJsonLikeValue(entryValue, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    try {
      const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        serializeJsonLikeValue(entryValue, seen),
      ]);
      return Object.fromEntries(entries);
    } finally {
      seen.delete(value as object);
    }
  }
  return String(value);
}

function isReturnableExpression(line: string): boolean {
  if (!line) return false;
  if (
    /^(return|throw|if|for|while|switch|try|catch|finally|const|let|var|function|class|import|export|await|yield)\b/.test(
      line,
    )
  ) {
    return false;
  }
  if (/[{}]$/.test(line)) {
    return false;
  }
  return true;
}

function stripTrailingSemicolon(line: string): string {
  return line.replace(/;\s*$/, '');
}
