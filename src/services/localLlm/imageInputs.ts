// ---------------------------------------------------------------------------
// Kavi — Images an on-device model is shown
// ---------------------------------------------------------------------------
// Chat images arrive as data URIs; LiteRT-LM reads an image from a file (Kotlin
// Content.ImageFile, Swift .imageFile). Each image is written once to the cache, named by
// its hash, so a turn that is retried or continued after a tool call reuses the file, and
// the folder is pruned to the most recent few so it never grows without bound.

import { Directory, File, Paths } from 'expo-file-system';

import { createLogger } from '../../utils/logger';
import { sha256HexUtf8Async } from '../../utils/sha256Async';
import { getNativeLocalLlmModelPath } from './modelArtifacts';
import type { NativeLocalLlmConversationMessage } from './nativeTypes';
import type { LocalStructuredMessage } from './types';

const log = createLogger('local-llm-images');

/** Files kept between turns: a few turns of images, never the whole history. */
const MAX_CACHED_IMAGE_FILES = 16;
const HASH_NAME_CHARS = 32;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

function inputsDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'local-llm', 'inputs');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** The cached file holding [uri]'s image, written on first use. */
async function imageFileFor(uri: string, directory: Directory): Promise<File> {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/isu.exec(uri);
  if (!match) throw new Error('An on-device image must be a base64 data URI.');
  const [, mimeType, base64] = match;
  const hash = (await sha256HexUtf8Async(base64!)).slice(0, HASH_NAME_CHARS);
  const file = new File(directory, `${hash}.${EXTENSIONS[mimeType!.toLowerCase()] ?? 'img'}`);
  if (!file.exists) file.write(base64!, { encoding: 'base64' });
  return file;
}

/** Deletes the oldest cached images beyond the limit, never the ones this turn uses. */
function pruneImageFiles(directory: Directory, inUse: ReadonlySet<string>): void {
  const others = directory
    .list()
    .filter((entry): entry is File => entry instanceof File && !inUse.has(entry.uri))
    .sort((left, right) => (right.modificationTime ?? 0) - (left.modificationTime ?? 0));
  for (const file of others.slice(Math.max(0, MAX_CACHED_IMAGE_FILES - inUse.size))) {
    try {
      file.delete();
    } catch (error) {
      log.warn('Could not delete a cached on-device image', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** [message] as the native runtime takes it: its images as file paths. */
export async function withLocalImageFiles(
  message: LocalStructuredMessage,
): Promise<NativeLocalLlmConversationMessage> {
  const { imageUris, ...rest } = message;
  if (!imageUris?.length) return rest;
  const directory = inputsDirectory();
  const files = await Promise.all(imageUris.map((uri) => imageFileFor(uri, directory)));
  pruneImageFiles(directory, new Set(files.map((file) => file.uri)));
  return { ...rest, imagePaths: files.map((file) => getNativeLocalLlmModelPath(file.uri)) };
}
