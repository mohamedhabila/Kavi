import { buildHeadTailExcerpt } from '../../../utils/headTailExcerpt';
import {
  isRecord,
  limitArray,
  normalizeResult,
  previewUnknown,
  type JsonRecord,
} from './resultNormalizer';
import {
  approxBinaryBytes,
  MAX_BROWSER_MESSAGES,
  MAX_BROWSER_SNAPSHOT_CHARS,
  MAX_EXEC_OUTPUT_CHARS,
  truncateText,
} from './transformers';

function normalizeBrowserSummary(name: string, payload: JsonRecord): string {
  switch (name) {
    case 'browser_launch':
      return typeof payload.sessionId === 'string'
        ? `Browser session launched: ${payload.sessionId}.`
        : 'Browser session launched.';
    case 'browser_stop':
      return 'Browser session stopped.';
    case 'browser_status':
      return `Browser session ${typeof payload.sessionId === 'string' ? payload.sessionId : ''} is ${typeof payload.status === 'string' ? payload.status : 'unknown'}.`.trim();
    case 'browser_navigate':
      return `Navigated browser target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}${typeof payload.url === 'string' ? ` to ${payload.url}` : ''}.`;
    case 'browser_snapshot':
      return `Captured browser snapshot for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_console':
      return `Captured browser console output for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_errors':
      return `Captured browser page errors for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_network':
      return `Captured browser network activity for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_cookies':
      return `Captured browser cookies for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_storage':
      return `Captured browser storage for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_screenshot':
      return `Captured browser screenshot for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_pdf':
      return `Captured browser PDF for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    default:
      return `Browser ${name.replace(/^browser_/, '')} completed.`;
  }
}

function compactBrowserConsoleMessages(messages: unknown[]): Array<JsonRecord> {
  return messages
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      type: typeof entry.type === 'string' ? entry.type : 'log',
      text: truncateText(typeof entry.text === 'string' ? entry.text : '', 240),
      ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
      ...(typeof entry.lineNumber === 'number' ? { lineNumber: entry.lineNumber } : {}),
    }));
}

function compactBrowserPageErrors(errors: unknown[]): Array<JsonRecord> {
  return errors
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      message: truncateText(typeof entry.message === 'string' ? entry.message : '', 240),
      ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
      ...(typeof entry.lineNumber === 'number' ? { lineNumber: entry.lineNumber } : {}),
    }));
}

function compactBrowserRequests(requests: unknown[]): Array<JsonRecord> {
  return requests
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      method: typeof entry.method === 'string' ? entry.method : 'GET',
      url: truncateText(typeof entry.url === 'string' ? entry.url : '', 220),
      ...(typeof entry.status === 'number' ? { status: entry.status } : {}),
      ...(typeof entry.resourceType === 'string' ? { resourceType: entry.resourceType } : {}),
    }))
    .sort((left, right) => {
      const leftFailed = typeof left.status === 'number' && left.status >= 400;
      const rightFailed = typeof right.status === 'number' && right.status >= 400;
      return Number(rightFailed) - Number(leftFailed);
    });
}

function compactBrowserCookies(cookies: unknown[]): Array<JsonRecord> {
  return cookies
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
      ...(typeof entry.domain === 'string' ? { domain: entry.domain } : {}),
      ...(typeof entry.path === 'string' ? { path: entry.path } : {}),
      ...(typeof entry.sameSite === 'string' ? { sameSite: entry.sameSite } : {}),
      ...(typeof entry.secure === 'boolean' ? { secure: entry.secure } : {}),
      ...(typeof entry.httpOnly === 'boolean' ? { httpOnly: entry.httpOnly } : {}),
      ...(typeof entry.expires === 'number' ? { expires: entry.expires } : {}),
    }));
}

function compactBrowserStorageValues(values: JsonRecord): Array<JsonRecord> {
  return Object.entries(values).map(([key, value]) => ({
    key,
    valuePreview: previewUnknown(value, 180),
  }));
}

export function normalizeBrowserToolResult(name: string, rawResult: string): string {
  return normalizeResult(rawResult, {
    jsonParse: true,
    fallback: rawResult,
    transform(parsed) {
      if (name === 'browser_screenshot' && typeof parsed.imageBase64 === 'string') {
        return JSON.stringify({
          summary: `Captured browser screenshot for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}. Binary image omitted from tool context.`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          ...(typeof parsed.url === 'string' ? { url: parsed.url } : {}),
          imageBytes: approxBinaryBytes(parsed.imageBase64),
          note: 'Use browser_snapshot for text inspection. Screenshot base64 is omitted to preserve context.',
        });
      }

      if (name === 'browser_pdf' && typeof parsed.base64 === 'string') {
        return JSON.stringify({
          summary: `Captured browser PDF for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}. Binary PDF omitted from tool context.`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          ...(typeof parsed.pages === 'number' ? { pages: parsed.pages } : {}),
          ...(typeof parsed.size === 'number' ? { size: parsed.size } : {}),
          pdfBytes: approxBinaryBytes(parsed.base64),
          note: 'PDF base64 is omitted to preserve context.',
        });
      }

      if (name === 'browser_snapshot' && typeof parsed.snapshot === 'string') {
        const snapshot = parsed.snapshot;
        const truncated = parsed.truncated === true || snapshot.length > MAX_BROWSER_SNAPSHOT_CHARS;
        return JSON.stringify({
          summary: `Captured browser snapshot for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}${truncated ? ' (trimmed for context).' : '.'}`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          snapshot: truncated
            ? buildHeadTailExcerpt(snapshot, MAX_BROWSER_SNAPSHOT_CHARS)
            : snapshot,
          snapshotChars: snapshot.length,
          truncated,
        });
      }

      if (name === 'browser_console' && Array.isArray(parsed.messages)) {
        const normalizedMessages = compactBrowserConsoleMessages(parsed.messages);
        const { items, omitted } = limitArray(normalizedMessages, MAX_BROWSER_MESSAGES);
        return JSON.stringify({
          summary: `Captured ${normalizedMessages.length} browser console messages for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}.`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          count: normalizedMessages.length,
          messages: items,
          ...(omitted > 0 ? { omittedMessages: omitted } : {}),
        });
      }

      if (name === 'browser_errors' && Array.isArray(parsed.errors)) {
        const normalizedErrors = compactBrowserPageErrors(parsed.errors);
        const { items, omitted } = limitArray(normalizedErrors, MAX_BROWSER_MESSAGES);
        return JSON.stringify({
          summary: `Captured ${normalizedErrors.length} browser page errors for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}.`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          count: normalizedErrors.length,
          errors: items,
          ...(omitted > 0 ? { omittedErrors: omitted } : {}),
        });
      }

      if (name === 'browser_network' && Array.isArray(parsed.requests)) {
        const normalizedRequests = compactBrowserRequests(parsed.requests);
        const { items, omitted } = limitArray(normalizedRequests, MAX_BROWSER_MESSAGES);
        const failedCount = normalizedRequests.filter(
          (entry) => typeof entry.status === 'number' && entry.status >= 400,
        ).length;
        return JSON.stringify({
          summary: `Captured ${normalizedRequests.length} browser network requests for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}${failedCount > 0 ? ` (${failedCount} failed).` : '.'}`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          count: normalizedRequests.length,
          failedCount,
          requests: items,
          ...(omitted > 0 ? { omittedRequests: omitted } : {}),
        });
      }

      if (name === 'browser_cookies' && Array.isArray(parsed.cookies)) {
        const normalizedCookies = compactBrowserCookies(parsed.cookies);
        const { items, omitted } = limitArray(normalizedCookies, MAX_BROWSER_MESSAGES);
        return JSON.stringify({
          summary: `Captured ${normalizedCookies.length} browser cookies for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}. Cookie values omitted from tool context.`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          count: normalizedCookies.length,
          cookies: items,
          ...(omitted > 0 ? { omittedCookies: omitted } : {}),
        });
      }

      if (name === 'browser_storage' && isRecord(parsed.values)) {
        const items = compactBrowserStorageValues(parsed.values);
        const limitedItems = limitArray(items, MAX_BROWSER_MESSAGES);
        return JSON.stringify({
          summary: `Captured ${items.length} browser storage values for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}.`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          count: items.length,
          values: limitedItems.items,
          ...(limitedItems.omitted > 0 ? { omittedValues: limitedItems.omitted } : {}),
        });
      }

      if (name === 'browser_download' && Array.isArray(parsed.downloads)) {
        const normalizedDownloads = parsed.downloads
          .filter((entry) => isRecord(entry))
          .map((entry) => ({
            ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
            ...(typeof entry.suggestedFilename === 'string'
              ? { suggestedFilename: entry.suggestedFilename }
              : {}),
            ...(typeof entry.path === 'string' ? { path: entry.path } : {}),
          }));
        const { items, omitted } = limitArray(normalizedDownloads, MAX_BROWSER_MESSAGES);
        return JSON.stringify({
          summary: `Captured ${normalizedDownloads.length} browser downloads for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}.`,
          ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
          count: normalizedDownloads.length,
          downloads: items,
          ...(omitted > 0 ? { omittedDownloads: omitted } : {}),
        });
      }

      const summary =
        typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
          ? parsed.summary
          : normalizeBrowserSummary(name, parsed);

      if (typeof parsed.result === 'string' && parsed.result.length > MAX_EXEC_OUTPUT_CHARS) {
        const { result, ...rest } = parsed;
        return JSON.stringify({
          summary,
          ...rest,
          resultPreview: buildHeadTailExcerpt(result, MAX_EXEC_OUTPUT_CHARS),
          resultChars: result.length,
          truncated: true,
        });
      }

      return JSON.stringify({
        summary,
        ...parsed,
      });
    },
  });
}
