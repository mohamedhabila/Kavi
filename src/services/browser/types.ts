/**
 * Browser automation action types.
 *
 * Defines the action request and response shapes for remote browser
 * automation via Browserbase and Browserless providers.
 */

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type BrowserActionOk = { ok: true };

export type BrowserActionTabResult = {
  ok: true;
  targetId: string;
  url?: string;
};

export type BrowserActionPathResult = {
  ok: true;
  path: string;
  targetId: string;
  url?: string;
};

export type BrowserActionTargetOk = { ok: true; targetId: string };

// ---------------------------------------------------------------------------
// Action request (discriminated union)
// ---------------------------------------------------------------------------

export type BrowserActRequest =
  | {
      kind: 'click';
      ref: string;
      targetId?: string;
      doubleClick?: boolean;
      button?: string;
      modifiers?: string[];
      timeoutMs?: number;
    }
  | {
      kind: 'type';
      ref: string;
      text: string;
      targetId?: string;
      submit?: boolean;
      slowly?: boolean;
      timeoutMs?: number;
    }
  | { kind: 'press'; key: string; targetId?: string; delayMs?: number }
  | { kind: 'hover'; ref: string; targetId?: string; timeoutMs?: number }
  | { kind: 'scrollIntoView'; ref: string; targetId?: string; timeoutMs?: number }
  | { kind: 'drag'; startRef: string; endRef: string; targetId?: string; timeoutMs?: number }
  | { kind: 'select'; ref: string; values: string[]; targetId?: string; timeoutMs?: number }
  | { kind: 'fill'; fields: BrowserFormField[]; targetId?: string; timeoutMs?: number }
  | { kind: 'resize'; width: number; height: number; targetId?: string }
  | {
      kind: 'wait';
      timeMs?: number;
      text?: string;
      textGone?: string;
      selector?: string;
      url?: string;
      loadState?: 'load' | 'domcontentloaded' | 'networkidle';
      fn?: string;
      targetId?: string;
      timeoutMs?: number;
    }
  | { kind: 'evaluate'; fn: string; ref?: string; targetId?: string; timeoutMs?: number }
  | { kind: 'close'; targetId?: string };

export type BrowserActResponse = {
  ok: true;
  targetId: string;
  url?: string;
  result?: unknown;
};

export type BrowserFormField = {
  ref: string;
  type: string;
  value?: string | number | boolean;
};

// ---------------------------------------------------------------------------
// Console / error / network observation types
// ---------------------------------------------------------------------------

export type BrowserConsoleMessage = {
  type: string;
  text: string;
  url?: string;
  lineNumber?: number;
};

export type BrowserPageError = {
  message: string;
  url?: string;
  lineNumber?: number;
};

export type BrowserNetworkRequest = {
  method: string;
  url: string;
  status?: number;
  resourceType?: string;
};

export type BrowserDownloadPayload = {
  url: string;
  suggestedFilename: string;
  path: string;
};

export type BrowserUploadResult = {
  ok: true;
  targetId: string;
  filename: string;
  size: number;
};

export type BrowserPdfResult = {
  ok: true;
  targetId: string;
  base64: string;
  pages: number;
  size: number;
};

export type BrowserDialogResult = {
  ok: true;
  targetId: string;
  dialogType: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  handled: boolean;
  response?: string;
};

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

export type BrowserSnapshotResult = {
  ok: true;
  targetId: string;
  snapshot: string;
  truncated?: boolean;
};

// ---------------------------------------------------------------------------
// Session status
// ---------------------------------------------------------------------------

export type BrowserSessionStatus = {
  ok: boolean;
  sessionId: string;
  status: string;
  pages?: number;
  url?: string;
};
