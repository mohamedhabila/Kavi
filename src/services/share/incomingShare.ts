// ---------------------------------------------------------------------------
// Kavi — Incoming Share
// ---------------------------------------------------------------------------
// What another app shared into Kavi (the system share sheet), as composer input: shared
// text and links become the draft's text, shared photos and files become its attachments.
// The person then says what to do with them and sends, as with the attach button.

import type { ResolvedSharePayload } from 'expo-sharing';
import type { PickedComposerImage } from '../media/composerImage';
import type { Attachment } from '../../types/attachment';

export type IncomingShareInput = Readonly<{
  text: string;
  attachments: Attachment[];
  /** Shared photos or files whose content could not be copied into Kavi. */
  unreadableCount: number;
}>;

export type IncomingShareDependencies = Readonly<{
  createId: () => string;
  /** Whether the copy of a shared file exists (the copy fails when the app is denied access). */
  fileExists: (uri: string) => boolean;
  measureImage: (uri: string) => Promise<{ width: number; height: number }>;
  prepareImage: (
    image: PickedComposerImage,
    id: string,
    fallbackName: string,
  ) => Promise<Attachment>;
}>;

/** `File.toURI()` on Android yields `file:/path`; the app's file APIs expect `file:///path`. */
export function normalizeSharedFileUri(uri: string): string {
  return /^file:\/[^/]/u.test(uri) ? `file:///${uri.slice('file:/'.length)}` : uri;
}

function fallbackName(payload: ResolvedSharePayload, index: number): string {
  const extension = payload.contentMimeType?.split('/')[1]?.split(/[;+]/u)[0];
  return `shared-${index + 1}${extension ? `.${extension}` : ''}`;
}

async function sharedAttachment(
  payload: ResolvedSharePayload,
  index: number,
  dependencies: IncomingShareDependencies,
): Promise<Attachment | 'unreadable'> {
  if (!payload.contentUri) return 'unreadable';
  const uri = normalizeSharedFileUri(payload.contentUri);
  if (!dependencies.fileExists(uri)) return 'unreadable';
  const name = payload.originalName || fallbackName(payload, index);
  const mimeType = payload.contentMimeType || payload.mimeType || 'application/octet-stream';
  const id = dependencies.createId();
  if (payload.contentType === 'image') {
    const size = await dependencies.measureImage(uri).catch(() => ({ width: NaN, height: NaN }));
    return dependencies.prepareImage(
      {
        uri,
        width: size.width,
        height: size.height,
        fileName: name,
        mimeType,
        fileSize: payload.contentSize,
      },
      id,
      name,
    );
  }
  return { id, type: 'file', uri, name, mimeType, size: payload.contentSize ?? 0 };
}

/**
 * The composer input for what was shared: each distinct text or link on its own paragraph,
 * and every shared photo or file as an attachment. A link the sharing app sent both as text
 * and as a link appears once. A photo or file that could not be copied is counted, not
 * attached, so the composer never holds an attachment that cannot be read.
 */
export async function buildIncomingShareInput(
  payloads: ReadonlyArray<ResolvedSharePayload>,
  dependencies: IncomingShareDependencies,
): Promise<IncomingShareInput> {
  const texts: string[] = [];
  const attachments: Attachment[] = [];
  let unreadableCount = 0;
  for (const [index, payload] of payloads.entries()) {
    // Text a share carries itself; a shared text file (text/markdown, .txt) has content and
    // is attached like any other file.
    if (payload.shareType === 'url' || (payload.shareType === 'text' && !payload.contentUri)) {
      const text = payload.value.trim();
      if (text && !texts.includes(text)) texts.push(text);
      continue;
    }
    const attachment = await sharedAttachment(payload, index, dependencies);
    if (attachment === 'unreadable') unreadableCount += 1;
    else attachments.push(attachment);
  }
  return { text: texts.join('\n\n'), attachments, unreadableCount };
}
