import { useSettingsStore } from '../../store/useSettingsStore';
import {
  browserNavigate,
  browserAct,
  browserScreenshot,
  browserSnapshot,
  browserConsoleMessages,
  browserPageErrors,
  browserNetworkRequests,
  browserSetCookies,
  browserClearCookies,
  browserGetCookies,
  browserStorageGet,
  browserStorageSet,
  browserStorageClear,
  browserSessionStatus,
  browserUpload,
  browserDownload,
  browserPdf,
  browserFillForm,
  browserDialog,
} from '../../services/browser/automation';
import { launchBrowserLiveSession, stopBrowserLiveSession } from '../../services/browser/jobs';
import type { BrowserActRequest } from '../../services/browser/types';
import { startBrowserTrace, completeBrowserTrace } from '../../services/browser/traceStore';
import { normalizeBrowserToolResult } from './toolResultNormalization';

export async function executeBrowserTool(name: string, args: any): Promise<string> {
  const sessionId = args.sessionId || '';
  const actionKind = name.replace('browser_', '');
  const description = buildBrowserTraceDescription(name, args);
  const traceId = sessionId
    ? startBrowserTrace(sessionId, actionKind, description, args as Record<string, unknown>)
    : '';
  const startMs = Date.now();

  try {
    const rawResult = await executeBrowserToolInner(name, args);
    const result = normalizeBrowserToolResult(name, rawResult);
    if (traceId && sessionId) {
      let parsedResponse: Record<string, unknown> | undefined;
      try {
        parsedResponse = JSON.parse(result);
      } catch {}
      completeBrowserTrace(traceId, sessionId, {
        status: 'success',
        response: parsedResponse,
        durationMs: Date.now() - startMs,
        pageUrl: parsedResponse?.url as string | undefined,
      });
    }
    return result;
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    if (traceId && sessionId) {
      completeBrowserTrace(traceId, sessionId, {
        status: 'error',
        error: errMessage,
        durationMs: Date.now() - startMs,
      });
    }
    throw err;
  }
}

function buildBrowserTraceDescription(name: string, args: any): string {
  switch (name) {
    case 'browser_launch':
      return 'Launch new browser session';
    case 'browser_stop':
      return `Stop session ${args.sessionId?.slice(0, 12) || ''}`;
    case 'browser_navigate':
      return `Navigate to ${args.url || ''}`;
    case 'browser_click':
      return `Click element ref=${args.ref || ''}`;
    case 'browser_type':
      return `Type "${(args.text || '').slice(0, 30)}" into ref=${args.ref || ''}`;
    case 'browser_press_key':
      return `Press key "${args.key || ''}"`;
    case 'browser_hover':
      return `Hover over ref=${args.ref || ''}`;
    case 'browser_select':
      return 'Select values in ref=' + (args.ref || '');
    case 'browser_drag':
      return `Drag from ${args.startRef || ''} to ${args.endRef || ''}`;
    case 'browser_wait':
      return args.text ? `Wait for text "${args.text}"` : `Wait ${args.timeMs || 0}ms`;
    case 'browser_screenshot':
      return 'Take screenshot';
    case 'browser_snapshot':
      return 'Capture page snapshot';
    case 'browser_console':
      return 'Read console messages';
    case 'browser_errors':
      return 'Read page errors';
    case 'browser_network':
      return 'Read network requests';
    case 'browser_cookies':
      return `Cookies: ${args.action || 'get'}`;
    case 'browser_storage':
      return `Storage: ${args.action || 'get'}`;
    case 'browser_evaluate':
      return 'Evaluate JavaScript';
    case 'browser_status':
      return 'Check session status';
    case 'browser_upload':
      return `Upload file to ref=${args.ref || ''}`;
    case 'browser_download':
      return `Download ${args.url ? 'from URL' : 'list downloads'}`;
    case 'browser_pdf':
      return 'Generate PDF';
    case 'browser_fill_form':
      return `Fill ${args.fields?.length || 0} form fields`;
    case 'browser_dialog':
      return `Dialog: ${args.action || 'accept'}`;
    default:
      return name;
  }
}

async function executeBrowserToolInner(name: string, args: any): Promise<string> {
  switch (name) {
    case 'browser_launch': {
      const settings = useSettingsStore.getState();
      const providers = settings.browserProviders || [];
      const provider = args.providerId
        ? providers.find((p: any) => p.id === args.providerId)
        : providers.find((p: any) => p.enabled !== false);
      if (!provider)
        return JSON.stringify({ status: 'error', message: 'No browser provider found' });
      const sessionId = await launchBrowserLiveSession(provider);
      return JSON.stringify({ status: 'ok', sessionId });
    }
    case 'browser_stop':
      await stopBrowserLiveSession(args.sessionId);
      return JSON.stringify({ status: 'ok', message: 'Session stopped' });
    case 'browser_status': {
      const status = await browserSessionStatus(args.sessionId);
      return JSON.stringify(status);
    }
    case 'browser_navigate': {
      const result = await browserNavigate(args.sessionId, {
        url: args.url,
        targetId: args.targetId,
      });
      return JSON.stringify(result);
    }
    case 'browser_click':
      return JSON.stringify(
        await browserAct(args.sessionId, {
          kind: 'click',
          ref: args.ref,
          doubleClick: args.doubleClick,
          button: args.button,
        } as BrowserActRequest),
      );
    case 'browser_type':
      return JSON.stringify(
        await browserAct(args.sessionId, {
          kind: 'type',
          ref: args.ref,
          text: args.text,
          submit: args.submit,
          slowly: args.slowly,
        } as BrowserActRequest),
      );
    case 'browser_press_key':
      return JSON.stringify(
        await browserAct(args.sessionId, { kind: 'press', key: args.key } as BrowserActRequest),
      );
    case 'browser_hover':
      return JSON.stringify(
        await browserAct(args.sessionId, { kind: 'hover', ref: args.ref } as BrowserActRequest),
      );
    case 'browser_select':
      return JSON.stringify(
        await browserAct(args.sessionId, {
          kind: 'select',
          ref: args.ref,
          values: args.values,
        } as BrowserActRequest),
      );
    case 'browser_drag':
      return JSON.stringify(
        await browserAct(args.sessionId, {
          kind: 'drag',
          startRef: args.startRef,
          endRef: args.endRef,
        } as BrowserActRequest),
      );
    case 'browser_wait':
      return JSON.stringify(
        await browserAct(args.sessionId, {
          kind: 'wait',
          timeMs: args.timeMs,
          text: args.text,
          textGone: args.textGone,
          selector: args.selector,
          url: args.url,
          loadState: args.loadState,
        } as BrowserActRequest),
      );
    case 'browser_screenshot': {
      const result = await browserScreenshot(args.sessionId, {
        fullPage: args.fullPage,
        ref: args.ref,
        type: args.type,
      });
      return JSON.stringify(result);
    }
    case 'browser_snapshot': {
      const result = await browserSnapshot(args.sessionId, { maxChars: args.maxChars });
      return JSON.stringify(result);
    }
    case 'browser_console': {
      const result = await browserConsoleMessages(args.sessionId, { level: args.level });
      return JSON.stringify(result);
    }
    case 'browser_errors': {
      const result = await browserPageErrors(args.sessionId, { clear: args.clear });
      return JSON.stringify(result);
    }
    case 'browser_network': {
      const result = await browserNetworkRequests(args.sessionId, {
        filter: args.filter,
        clear: args.clear,
      });
      return JSON.stringify(result);
    }
    case 'browser_cookies': {
      const action = args.action || 'get';
      if (action === 'set')
        return JSON.stringify(await browserSetCookies(args.sessionId, { cookie: args.cookie }));
      if (action === 'clear') return JSON.stringify(await browserClearCookies(args.sessionId));
      return JSON.stringify(await browserGetCookies(args.sessionId));
    }
    case 'browser_storage': {
      const action = args.action || 'get';
      if (action === 'set')
        return JSON.stringify(
          await browserStorageSet(args.sessionId, {
            kind: args.kind,
            key: args.key,
            value: args.value,
          }),
        );
      if (action === 'clear')
        return JSON.stringify(await browserStorageClear(args.sessionId, { kind: args.kind }));
      return JSON.stringify(
        await browserStorageGet(args.sessionId, { kind: args.kind, key: args.key }),
      );
    }
    case 'browser_evaluate':
      return JSON.stringify(
        await browserAct(args.sessionId, {
          kind: 'evaluate',
          fn: args.expression,
          ref: args.ref,
        } as BrowserActRequest),
      );
    case 'browser_upload':
      return JSON.stringify(
        await browserUpload(args.sessionId, {
          ref: args.ref,
          filePath: args.filePath,
          filename: args.filename,
          targetId: args.targetId,
        }),
      );
    case 'browser_download':
      return JSON.stringify(
        await browserDownload(args.sessionId, {
          url: args.url,
          suggestedFilename: args.suggestedFilename,
          waitMs: args.waitMs,
          targetId: args.targetId,
        }),
      );
    case 'browser_pdf':
      return JSON.stringify(
        await browserPdf(args.sessionId, {
          format: args.format,
          landscape: args.landscape,
          printBackground: args.printBackground,
          scale: args.scale,
          targetId: args.targetId,
        }),
      );
    case 'browser_fill_form': {
      const result = await browserFillForm(args.sessionId, {
        fields: args.fields,
        targetId: args.targetId,
        submit: args.submit,
      });
      return JSON.stringify(result);
    }
    case 'browser_dialog':
      return JSON.stringify(
        await browserDialog(args.sessionId, {
          action: args.action,
          promptText: args.promptText,
          targetId: args.targetId,
        }),
      );
    default:
      return `Error: unhandled browser tool "${name}"`;
  }
}
