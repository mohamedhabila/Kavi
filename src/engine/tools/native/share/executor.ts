import { executeStructuredNativeAction } from '../structuredAction';

export async function executeShare(args: { text?: string; url?: string }): Promise<string> {
  return executeStructuredNativeAction('share', args as Record<string, unknown>);
}

export async function executeShareText(args: { text: string; title?: string }): Promise<string> {
  return executeStructuredNativeAction('share_text', args as Record<string, unknown>);
}

export async function executeShareUrl(args: {
  url: string;
  message?: string;
  title?: string;
}): Promise<string> {
  return executeStructuredNativeAction('share_url', args as Record<string, unknown>);
}

export async function executeShareFile(args: {
  fileUri: string;
  mimeType?: string;
  dialogTitle?: string;
  uti?: string;
}): Promise<string> {
  return executeStructuredNativeAction('share_file', args as Record<string, unknown>);
}

export async function executeShareContact(args: { id: string; message?: string }): Promise<string> {
  return executeStructuredNativeAction('share_contact', args as Record<string, unknown>);
}
