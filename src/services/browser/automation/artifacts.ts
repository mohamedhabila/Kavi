import type { BrowserDialogResult, BrowserPdfResult, BrowserUploadResult } from '../types';
import {
  fetchBrowserProviderJson as fetchProviderJson,
  getBrowserProviderSessionBase,
  resolveBrowserAutomationSession as resolveSession,
} from './session';

export async function browserUpload(
  sessionId: string,
  opts: { ref: string; filePath: string; filename?: string; targetId?: string },
): Promise<BrowserUploadResult> {
  const s = await resolveSession(sessionId);
  const base = getBrowserProviderSessionBase(s);

  return fetchProviderJson<BrowserUploadResult>(
    `${base}/upload`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: opts.ref,
        filePath: opts.filePath,
        filename: opts.filename,
        targetId: opts.targetId,
      }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserDownload(
  sessionId: string,
  opts: { url?: string; suggestedFilename?: string; targetId?: string; waitMs?: number },
): Promise<{
  ok: true;
  targetId: string;
  downloads: Array<{ url: string; suggestedFilename: string; path: string }>;
}> {
  const s = await resolveSession(sessionId);
  const base = getBrowserProviderSessionBase(s);

  return fetchProviderJson(
    `${base}/downloads`,
    {
      method: 'POST',
      body: JSON.stringify({
        url: opts.url,
        suggestedFilename: opts.suggestedFilename,
        targetId: opts.targetId,
        waitMs: opts.waitMs ?? 5000,
      }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserPdf(
  sessionId: string,
  opts: {
    targetId?: string;
    format?: string;
    landscape?: boolean;
    printBackground?: boolean;
    scale?: number;
  },
): Promise<BrowserPdfResult> {
  const s = await resolveSession(sessionId);
  const base = getBrowserProviderSessionBase(s);

  return fetchProviderJson<BrowserPdfResult>(
    `${base}/pdf`,
    {
      method: 'POST',
      body: JSON.stringify({
        targetId: opts.targetId,
        format: opts.format || 'A4',
        landscape: opts.landscape || false,
        printBackground: opts.printBackground !== false,
        scale: opts.scale || 1,
      }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserDialog(
  sessionId: string,
  opts: { action: 'accept' | 'dismiss'; promptText?: string; targetId?: string },
): Promise<BrowserDialogResult> {
  const s = await resolveSession(sessionId);
  const base = getBrowserProviderSessionBase(s);

  return fetchProviderJson<BrowserDialogResult>(
    `${base}/dialog`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: opts.action,
        promptText: opts.promptText,
        targetId: opts.targetId,
      }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}
