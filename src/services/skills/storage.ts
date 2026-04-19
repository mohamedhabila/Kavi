import { Paths, File, Directory } from 'expo-file-system';
import type { SkillEntry } from './types';

const MANAGED_SKILLS_ROOT_DIR = '.managed-skills';
const WORKSPACE_SKILLS_DIR = 'skills';
const SKILL_FILE_NAME = 'SKILL.md';

function getDocumentRoot(): Directory {
  return new Directory(Paths.document);
}

function dirname(relativePath: string): string {
  const segments = relativePath.split('/');
  segments.pop();
  return segments.join('/');
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'skill';
}

export function normalizeSkillRelativePath(inputPath: string): string | null {
  const decoded = decodeURIComponent((inputPath || '').trim())
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  if (!decoded) {
    return null;
  }

  const segments: string[] = [];
  for (const rawSegment of decoded.split('/')) {
    const segment = rawSegment.trim();
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return null;
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return null;
  }

  return segments.join('/');
}

function toYamlScalar(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return JSON.stringify(trimmed.replace(/\r\n/g, '\n'));
}

function buildDefaultSkillFile(entry: SkillEntry): string {
  const frontmatterLines = [
    '---',
    `name: ${toYamlScalar(entry.metadata.name)}`,
    `description: ${toYamlScalar(entry.metadata.description || 'No description provided.')}`,
    `version: ${toYamlScalar(entry.metadata.version || '1.0.0')}`,
    ...(entry.metadata.author ? [`author: ${toYamlScalar(entry.metadata.author)}`] : []),
    '---',
    '',
  ];
  const body =
    (entry.systemPrompt || '').trim() || `# ${entry.metadata.name}\n\nNo instructions provided.`;
  return `${frontmatterLines.join('\n')}${body.endsWith('\n') ? body : `${body}\n`}`;
}

function getManagedDirName(entry: SkillEntry): string {
  return (
    entry.source.managedDir ||
    `${slugify(entry.metadata.name)}-${slugify(entry.source.id || entry.id)}`
  );
}

function getManagedSkillsRootDir(): Directory {
  return new Directory(getDocumentRoot(), MANAGED_SKILLS_ROOT_DIR);
}

function getManagedSkillDir(entry: SkillEntry): Directory {
  return new Directory(getManagedSkillsRootDir(), getManagedDirName(entry));
}

function getManagedBinaryFiles(entry: SkillEntry): Set<string> {
  return new Set(entry.source.managedBinaryFiles || []);
}

function getConversationWorkspaceRootDir(conversationId: string): Directory {
  return new Directory(getDocumentRoot(), 'workspace', conversationId);
}

async function ensureDirectory(dir: Directory): Promise<void> {
  await dir.create({ idempotent: true, intermediates: true });
}

async function deletePath(target: File | Directory): Promise<void> {
  try {
    if (target.exists) {
      target.delete();
    }
  } catch {
    // Best-effort cleanup.
  }
}

export async function saveManagedSkillBundle(
  entry: SkillEntry,
  files: Record<string, string>,
  binaryFiles: Record<string, Uint8Array> = {},
): Promise<SkillEntry> {
  const managedDir = getManagedDirName(entry);
  const managedDirPath = getManagedSkillDir(entry);
  await deletePath(managedDirPath);
  await ensureDirectory(managedDirPath);

  const normalizedFiles = new Map<string, string>();
  const normalizedBinaryFiles = new Map<string, Uint8Array>();
  normalizedFiles.set(SKILL_FILE_NAME, files[SKILL_FILE_NAME] || buildDefaultSkillFile(entry));

  for (const [relativePath, content] of Object.entries(files)) {
    const normalizedPath =
      relativePath === SKILL_FILE_NAME ? SKILL_FILE_NAME : normalizeSkillRelativePath(relativePath);
    if (!normalizedPath || normalizedPath === SKILL_FILE_NAME) {
      continue;
    }
    normalizedFiles.set(normalizedPath, content);
  }

  for (const [relativePath, content] of Object.entries(binaryFiles)) {
    const normalizedPath = normalizeSkillRelativePath(relativePath);
    if (
      !normalizedPath ||
      normalizedPath === SKILL_FILE_NAME ||
      normalizedFiles.has(normalizedPath)
    ) {
      continue;
    }
    normalizedBinaryFiles.set(
      normalizedPath,
      content instanceof Uint8Array ? content : new Uint8Array(content),
    );
  }

  for (const [relativePath, content] of normalizedFiles) {
    const parent = dirname(relativePath);
    if (parent) {
      await ensureDirectory(new Directory(managedDirPath, parent));
    }
    new File(managedDirPath, relativePath).write(content);
  }

  for (const [relativePath, content] of normalizedBinaryFiles) {
    const parent = dirname(relativePath);
    if (parent) {
      await ensureDirectory(new Directory(managedDirPath, parent));
    }
    new File(managedDirPath, relativePath).write(content);
  }

  const managedFiles = Array.from(
    new Set([...normalizedFiles.keys(), ...normalizedBinaryFiles.keys()]),
  ).sort();
  const managedBinaryFiles = Array.from(normalizedBinaryFiles.keys()).sort();

  return {
    ...entry,
    source: {
      ...entry.source,
      managedDir,
      managedFiles,
      managedBinaryFiles: managedBinaryFiles.length > 0 ? managedBinaryFiles : undefined,
    },
  };
}

export async function ensureManagedSkillBundle(entry: SkillEntry): Promise<SkillEntry> {
  const managedDir = getManagedSkillDir(entry);
  const skillFile = new File(managedDir, SKILL_FILE_NAME);
  if (skillFile.exists && entry.source.managedDir && entry.source.managedFiles?.length) {
    return entry;
  }

  return saveManagedSkillBundle(entry, { [SKILL_FILE_NAME]: buildDefaultSkillFile(entry) });
}

export async function deleteManagedSkillBundle(entry: SkillEntry): Promise<void> {
  if (!entry.source.managedDir) {
    return;
  }
  await deletePath(getManagedSkillDir(entry));
}

export async function syncSkillEntriesToConversationWorkspace(
  entries: SkillEntry[],
  conversationId: string,
): Promise<Array<{ entry: SkillEntry; location: string }>> {
  const workspaceSkillsRootDir = new Directory(
    getConversationWorkspaceRootDir(conversationId),
    WORKSPACE_SKILLS_DIR,
  );
  await ensureDirectory(workspaceSkillsRootDir);

  const synced: Array<{ entry: SkillEntry; location: string }> = [];
  const desiredDirs = new Set<string>();

  for (const entry of entries) {
    const ensured = await ensureManagedSkillBundle(entry);
    const managedDir = ensured.source.managedDir || getManagedDirName(ensured);
    const managedDirPath = getManagedSkillDir(ensured);
    const workspaceDir = new Directory(workspaceSkillsRootDir, managedDir);
    await deletePath(workspaceDir);
    await ensureDirectory(workspaceDir);

    const files = ensured.source.managedFiles?.length
      ? ensured.source.managedFiles
      : [SKILL_FILE_NAME];
    const binaryFiles = getManagedBinaryFiles(ensured);
    for (const relativePath of files) {
      const parent = dirname(relativePath);
      if (parent) {
        await ensureDirectory(new Directory(workspaceDir, parent));
      }
      const sourceFile = new File(managedDirPath, relativePath) as File & {
        bytes?: () => Promise<Uint8Array | ArrayBuffer>;
        arrayBuffer?: () => Promise<ArrayBuffer>;
      };
      const destinationFile = new File(workspaceDir, relativePath);
      if (binaryFiles.has(relativePath)) {
        if (typeof sourceFile.bytes === 'function') {
          const bytes = await sourceFile.bytes();
          destinationFile.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        } else if (typeof sourceFile.arrayBuffer === 'function') {
          destinationFile.write(new Uint8Array(await sourceFile.arrayBuffer()));
        } else {
          throw new Error(`Binary skill file ${relativePath} cannot be read in this runtime.`);
        }
      } else {
        destinationFile.write(await sourceFile.text());
      }
    }

    desiredDirs.add(managedDir);
    synced.push({
      entry: ensured,
      location: `${WORKSPACE_SKILLS_DIR}/${managedDir}/${SKILL_FILE_NAME}`,
    });
  }

  const existingDirs = workspaceSkillsRootDir.exists
    ? workspaceSkillsRootDir.list().filter((entry): entry is Directory => 'list' in entry)
    : [];
  await Promise.all(
    existingDirs.filter((dir) => !desiredDirs.has(dir.name)).map((dir) => deletePath(dir)),
  );

  return synced;
}
