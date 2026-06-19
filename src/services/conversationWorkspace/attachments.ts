import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { Attachment } from '../../types/attachment';
import type { ImportedAttachmentResult, UriFileWriteResult } from '../files/contracts';
import {
  base64ByteLength,
  normalizeConversationWorkspacePath,
  requireConversationWorkspacePath,
} from '../files/pathUtils';
import { readAttachmentBase64 } from '../media/attachmentPayloads';
import {
  ensureConversationWorkspaceParentDirectory,
  getConversationWorkspaceFileUri,
  writeConversationWorkspaceBinaryContent,
} from './storage';

const ATTACHMENT_WORKSPACE_ROOT = 'attachments';

export type ConversationWorkspaceImportedAttachmentResult = ImportedAttachmentResult<Attachment>;

function sanitizeAttachmentFileSegment(value: string): string {
  const normalized = value
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

  return normalized || 'file';
}

function getAttachmentExtensionCandidate(value: string | undefined): string | undefined {
  const match = value?.split(/[?#]/, 1)[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase();
}

function inferAttachmentExtension(
  attachment: Pick<Attachment, 'name' | 'uri' | 'mimeType' | 'type'>,
): string | undefined {
  const explicitExtension =
    getAttachmentExtensionCandidate(attachment.name) ||
    getAttachmentExtensionCandidate(attachment.uri);
  if (explicitExtension) {
    return explicitExtension;
  }

  const mimeType = attachment.mimeType?.trim().toLowerCase() || '';
  const fromMime = mimeType.includes('/') ? mimeType.split('/').pop() : '';
  if (fromMime) {
    if (fromMime === 'jpeg') {
      return 'jpg';
    }
    if (fromMime === 'plain') {
      return 'txt';
    }
    if (/^[a-z0-9.+-]+$/i.test(fromMime)) {
      return fromMime;
    }
  }

  switch (attachment.type) {
    case 'image':
      return 'jpg';
    case 'audio':
      return 'm4a';
    default:
      return 'txt';
  }
}

function sanitizeAttachmentFileName(
  attachment: Pick<Attachment, 'id' | 'name' | 'uri' | 'mimeType' | 'type'>,
): string {
  const rawName =
    attachment.name?.trim() || attachment.uri?.split(/[?#]/, 1)[0].split('/').pop()?.trim() || '';
  const extension = inferAttachmentExtension(attachment);
  const stemSource = rawName
    ? rawName.replace(/\.[a-zA-Z0-9]+$/, '')
    : `${attachment.type || 'file'}-${attachment.id || 'attachment'}`;
  const stem = sanitizeAttachmentFileSegment(stemSource);
  const safeExtension = extension ? sanitizeAttachmentFileSegment(extension).toLowerCase() : '';
  return safeExtension ? `${stem}.${safeExtension}` : stem;
}

function getAttachmentWorkspaceDirectory(type: Attachment['type']): string {
  switch (type) {
    case 'image':
      return `${ATTACHMENT_WORKSPACE_ROOT}/images`;
    case 'audio':
      return `${ATTACHMENT_WORKSPACE_ROOT}/audio`;
    default:
      return `${ATTACHMENT_WORKSPACE_ROOT}/files`;
  }
}

function buildImportedAttachmentWorkspacePath(
  attachment: Pick<Attachment, 'id' | 'type' | 'name' | 'uri' | 'mimeType'>,
): string {
  const safeId = sanitizeAttachmentFileSegment(attachment.id || 'attachment');
  const safeName = sanitizeAttachmentFileName(attachment);
  return normalizeConversationWorkspacePath(
    `${getAttachmentWorkspaceDirectory(attachment.type)}/${safeId}-${safeName}`,
  );
}

async function copyAttachmentToWorkspace(
  conversationId: string,
  safePath: string,
  attachment: Attachment,
): Promise<UriFileWriteResult> {
  const destinationUri = getConversationWorkspaceFileUri(conversationId, safePath);
  const destinationFile = new File(destinationUri);

  if (attachment.uri && !/^data:/i.test(attachment.uri)) {
    try {
      const sourceFile = new File(attachment.uri);
      sourceFile.copy(destinationFile);
      return {
        path: safePath,
        size: typeof destinationFile.size === 'number' ? destinationFile.size : attachment.size,
        uri: destinationUri,
      };
    } catch {
      // Fall through to byte/base64-based persistence for providers that do not support direct copy.
    }

    try {
      const sourceFile = new File(attachment.uri);
      if (typeof sourceFile.bytes === 'function') {
        const bytes = await sourceFile.bytes();
        return await writeConversationWorkspaceBinaryContent(
          conversationId,
          safePath,
          bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        );
      }

      if (typeof sourceFile.arrayBuffer === 'function') {
        return await writeConversationWorkspaceBinaryContent(
          conversationId,
          safePath,
          new Uint8Array(await sourceFile.arrayBuffer()),
        );
      }
    } catch {
      // Fall through to base64-based persistence.
    }
  }

  const base64 = await readAttachmentBase64(attachment);
  if (base64) {
    const normalizedBase64 = base64.replace(/\s+/g, '');
    await ensureConversationWorkspaceParentDirectory(conversationId, safePath);
    await LegacyFileSystem.writeAsStringAsync(destinationUri, normalizedBase64, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    } as any);
    return {
      path: safePath,
      size: attachment.size > 0 ? attachment.size : base64ByteLength(normalizedBase64),
      uri: destinationUri,
    };
  }

  throw new Error(
    `Unable to copy attachment into the conversation workspace: ${attachment.name || attachment.uri || attachment.id}`,
  );
}

export async function importConversationWorkspaceAttachment(
  conversationId: string,
  attachment: Attachment,
): Promise<ConversationWorkspaceImportedAttachmentResult> {
  const requestedPath = attachment.workspacePath?.trim();
  const safePath = requestedPath
    ? requireConversationWorkspacePath(requestedPath)
    : buildImportedAttachmentWorkspacePath(attachment);
  const workspaceUri = getConversationWorkspaceFileUri(conversationId, safePath);
  const workspaceFile = new File(workspaceUri);

  if (!workspaceFile.exists) {
    await copyAttachmentToWorkspace(conversationId, safePath, attachment);
  }

  return {
    imported: !requestedPath || attachment.uri !== workspaceUri,
    attachment: {
      ...attachment,
      uri: workspaceUri,
      workspacePath: safePath,
      size:
        typeof workspaceFile.size === 'number' && workspaceFile.size > 0
          ? workspaceFile.size
          : attachment.size,
    },
  };
}
