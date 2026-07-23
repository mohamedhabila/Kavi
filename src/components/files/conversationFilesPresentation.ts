import type { FileEntry } from '../../services/files/contracts';
import { redactSensitiveText } from '../../services/security/toolDetailRedaction';

export type ConversationFileFilter =
  | 'all'
  | 'documents'
  | 'images'
  | 'audio'
  | 'code'
  | 'other';

export type ConversationFileSort = 'recent' | 'name';

const DOCUMENT_EXTENSIONS = new Set([
  'doc',
  'docx',
  'csv',
  'key',
  'md',
  'numbers',
  'odt',
  'ods',
  'odp',
  'pages',
  'pdf',
  'ppt',
  'pptx',
  'rtf',
  'txt',
  'xls',
  'xlsx',
]);
const IMAGE_EXTENSIONS = new Set(['bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const CODE_EXTENSIONS = new Set([
  'c',
  'cpp',
  'css',
  'go',
  'h',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'swift',
  'toml',
  'ts',
  'tsx',
  'xml',
  'yaml',
  'yml',
]);

function getExtension(name: string): string {
  const finalSegment = name.toLowerCase().split('/').pop() ?? '';
  return finalSegment.includes('.') ? (finalSegment.split('.').pop() ?? '') : '';
}

function getModifiedTimestamp(entry: FileEntry): number {
  if (!entry.modifiedAt) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(entry.modifiedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function getSafeConversationFileName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') return fallback;
  const safeName = redactSensitiveText(name)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160);
  return safeName || fallback;
}

export function getConversationFileCategory(name: string): Exclude<ConversationFileFilter, 'all'> {
  const extension = getExtension(name);
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'documents';
  if (IMAGE_EXTENSIONS.has(extension)) return 'images';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  return 'other';
}

export function getVisibleConversationFileEntries<TEntry extends FileEntry>(
  entries: TEntry[],
  searchQuery: string,
  filter: ConversationFileFilter,
  sort: ConversationFileSort,
): TEntry[] {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  return entries
    .filter((entry) => {
      if (normalizedQuery && !entry.name.toLocaleLowerCase().includes(normalizedQuery)) {
        return false;
      }
      return entry.isDirectory || filter === 'all' || getConversationFileCategory(entry.name) === filter;
    })
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
      if (sort === 'recent') {
        const leftModifiedAt = getModifiedTimestamp(left);
        const rightModifiedAt = getModifiedTimestamp(right);
        if (leftModifiedAt !== rightModifiedAt) {
          return rightModifiedAt > leftModifiedAt ? 1 : -1;
        }
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
}

export function formatConversationFileSize(size: unknown): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatConversationFileModifiedAt(
  modifiedAt: string | undefined,
  locale: string,
): string | null {
  if (!modifiedAt) return null;
  const date = new Date(modifiedAt);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
