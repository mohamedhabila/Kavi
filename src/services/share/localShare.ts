import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { inspectConversationWorkspaceFile } from '../conversationWorkspace/files';

const SHARE_EXPORT_DIRECTORY = 'share-exports';
const DEFAULT_TEXT_MIME_TYPE = 'text/plain';
const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  gif: 'image/gif',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  xml: 'application/xml',
  yml: 'application/yaml',
  yaml: 'application/yaml',
};

export interface ShareLocalFileParams {
  fileUri: string;
  dialogTitle?: string;
  mimeType?: string;
  uti?: string;
}

export interface ShareTextExportParams {
  content: string;
  fileName: string;
  dialogTitle?: string;
  mimeType?: string;
  uti?: string;
}

export interface ShareConversationWorkspaceFileParams {
  conversationId: string;
  path: string;
  fallbackConversationIds?: string[];
  dialogTitle?: string;
  mimeType?: string;
  uti?: string;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function getFileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const extension = normalized.includes('.') ? normalized.split('.').pop() : '';
  return extension || '';
}

function inferMimeTypeFromFileName(fileName: string): string | undefined {
  const extension = getFileExtension(fileName);
  return extension ? MIME_TYPES_BY_EXTENSION[extension] : undefined;
}

function inferUtiFromMimeType(mimeType?: string): string | undefined {
  switch (mimeType) {
    case 'text/markdown':
      return 'net.daringfireball.markdown';
    case 'text/plain':
      return 'public.plain-text';
    case 'application/json':
      return 'public.json';
    case 'image/png':
      return 'public.png';
    case 'image/jpeg':
      return 'public.jpeg';
    case 'application/pdf':
      return 'com.adobe.pdf';
    default:
      return undefined;
  }
}

function sanitizeShareFileName(fileName: string): string {
  const normalized = fileName.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  const lastDotIndex = normalized.lastIndexOf('.');
  const hasExtension = lastDotIndex > 0 && lastDotIndex < normalized.length - 1;
  const stem = hasExtension ? normalized.slice(0, lastDotIndex) : normalized;
  const extension = hasExtension ? normalized.slice(lastDotIndex + 1) : '';
  const sanitizedStem =
    stem
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '') || 'share-export';
  const sanitizedExtension = extension.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();

  return sanitizedExtension ? `${sanitizedStem}.${sanitizedExtension}` : sanitizedStem;
}

async function ensureSharingAvailable(): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is unavailable on this device.');
  }
}

async function ensureShareExportDirectory(): Promise<Directory> {
  const directory = new Directory(Paths.cache, SHARE_EXPORT_DIRECTORY);
  await directory.create({ idempotent: true, intermediates: true });
  return directory;
}

export async function shareLocalFile(params: ShareLocalFileParams): Promise<void> {
  const fileUri = requireNonEmptyString(params.fileUri, 'fileUri');
  await ensureSharingAvailable();
  await Sharing.shareAsync(fileUri, {
    dialogTitle: params.dialogTitle,
    mimeType: params.mimeType,
    UTI: params.uti ?? inferUtiFromMimeType(params.mimeType),
  });
}

export async function shareTextExport(
  params: ShareTextExportParams,
): Promise<{ fileName: string; fileUri: string }> {
  const content = requireNonEmptyString(params.content, 'content');
  const requestedFileName = requireNonEmptyString(params.fileName, 'fileName');
  const shareDirectory = await ensureShareExportDirectory();
  const fileName = sanitizeShareFileName(requestedFileName);
  const file = new File(shareDirectory, fileName);
  const mimeType = params.mimeType || inferMimeTypeFromFileName(fileName) || DEFAULT_TEXT_MIME_TYPE;

  file.write(content);
  await shareLocalFile({
    fileUri: file.uri,
    dialogTitle: params.dialogTitle,
    mimeType,
    uti: params.uti ?? inferUtiFromMimeType(mimeType),
  });

  return {
    fileName,
    fileUri: file.uri,
  };
}

export async function shareConversationWorkspaceFile(
  params: ShareConversationWorkspaceFileParams,
): Promise<{ conversationId: string; path: string; fileUri: string }> {
  const inspection = await inspectConversationWorkspaceFile(
    params.conversationId,
    params.path,
    params.fallbackConversationIds,
  );
  const mimeType = params.mimeType || inferMimeTypeFromFileName(inspection.path);

  await shareLocalFile({
    fileUri: inspection.uri,
    dialogTitle: params.dialogTitle,
    mimeType,
    uti: params.uti ?? inferUtiFromMimeType(mimeType),
  });

  return {
    conversationId: inspection.conversationId,
    path: inspection.path,
    fileUri: inspection.uri,
  };
}
