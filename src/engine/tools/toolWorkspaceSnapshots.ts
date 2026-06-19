import { Directory, File } from 'expo-file-system';
import type { PythonWorkspaceFile } from '../../services/python/pyodideBridge';
import { extractPep723Dependencies } from '../../services/python/scriptMetadata';
import {
  ensureWorkspaceDir,
  getWorkspaceDir,
  readConversationWorkspaceFile,
  sanitizeToolWorkspacePath,
} from './toolWorkspaceFiles';

const PYTHON_WORKSPACE_MAX_FILES = 128;
const PYTHON_WORKSPACE_MAX_BYTES = 8 * 1024 * 1024;
const JAVASCRIPT_WORKSPACE_MAX_FILES = 128;
const JAVASCRIPT_WORKSPACE_MAX_BYTES = 8 * 1024 * 1024;

type WorkspaceSnapshotUsage = {
  fileCount: number;
  totalBytes: number;
};

type WorkspaceSnapshotLimits = {
  maxFiles: number;
  maxBytes: number;
  label: string;
};

const WORKSPACE_TEXT_DECODER = new TextDecoder();

function encodeBytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (
    globalThis as { Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } } }
  ).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString('base64');
  }

  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join('');
  return btoa(binary);
}

function decodeBase64ToBytes(base64Data: string): Uint8Array {
  const sanitized = base64Data.replace(/\s+/g, '');
  const bufferCtor = (
    globalThis as { Buffer?: { from(data: string, encoding: string): Uint8Array } }
  ).Buffer;
  if (bufferCtor) {
    return new Uint8Array(bufferCtor.from(sanitized, 'base64'));
  }

  const binary = atob(sanitized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function readConversationWorkspaceBytes(
  conversationId: string,
  safePath: string,
): Promise<Uint8Array> {
  const file = new File(getWorkspaceDir(conversationId), safePath);

  if (!file.exists) {
    throw new Error(`file not found: ${safePath}`);
  }

  const candidate = file as File & {
    bytes?: () => Promise<Uint8Array | ArrayBuffer>;
  };

  if (typeof candidate.bytes === 'function') {
    const bytes = await candidate.bytes();
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  return new TextEncoder().encode(await file.text());
}

function getParentWorkspacePath(safePath: string): string {
  const parts = safePath.split('/');
  parts.pop();
  return parts.join('/');
}

async function addWorkspaceSnapshotFile(
  conversationId: string,
  safePath: string,
  snapshotFiles: Map<string, Uint8Array>,
  usage: WorkspaceSnapshotUsage,
  limits: WorkspaceSnapshotLimits,
): Promise<void> {
  if (!safePath || snapshotFiles.has(safePath)) {
    return;
  }

  if (usage.fileCount >= limits.maxFiles) {
    throw new Error(`${limits.label} exceeded ${limits.maxFiles} files.`);
  }

  const bytes = await readConversationWorkspaceBytes(conversationId, safePath);
  if (usage.totalBytes + bytes.length > limits.maxBytes) {
    throw new Error(`${limits.label} exceeded ${Math.floor(limits.maxBytes / (1024 * 1024))}MB.`);
  }

  snapshotFiles.set(safePath, bytes);
  usage.fileCount += 1;
  usage.totalBytes += bytes.length;
}

async function collectWorkspaceSnapshotDirectory(
  conversationId: string,
  relativeDirPath: string,
  directory: Directory,
  snapshotFiles: Map<string, Uint8Array>,
  usage: WorkspaceSnapshotUsage,
  limits: WorkspaceSnapshotLimits,
): Promise<void> {
  const entries = directory.list();
  for (const entry of entries) {
    const childPath = relativeDirPath ? `${relativeDirPath}/${entry.name}` : entry.name;
    if ('list' in entry) {
      await collectWorkspaceSnapshotDirectory(
        conversationId,
        childPath,
        entry as Directory,
        snapshotFiles,
        usage,
        limits,
      );
      continue;
    }

    await addWorkspaceSnapshotFile(conversationId, childPath, snapshotFiles, usage, limits);
  }
}

async function collectConversationWorkspaceSnapshot(
  conversationId: string,
  snapshotFiles: Map<string, Uint8Array>,
  usage: WorkspaceSnapshotUsage,
  limits: WorkspaceSnapshotLimits,
): Promise<void> {
  const workspaceDir = getWorkspaceDir(conversationId);
  if (!workspaceDir.exists) {
    return;
  }

  await collectWorkspaceSnapshotDirectory(
    conversationId,
    '',
    workspaceDir,
    snapshotFiles,
    usage,
    limits,
  );
}

async function collectWorkspaceSnapshotWithFallback(
  conversationId: string,
  fallbackConversationId: string | undefined,
  snapshotFiles: Map<string, Uint8Array>,
  usage: WorkspaceSnapshotUsage,
  limits: WorkspaceSnapshotLimits,
): Promise<void> {
  await collectConversationWorkspaceSnapshot(conversationId, snapshotFiles, usage, limits);

  if (fallbackConversationId && fallbackConversationId !== conversationId) {
    await collectConversationWorkspaceSnapshot(
      fallbackConversationId,
      snapshotFiles,
      usage,
      limits,
    );
  }
}

function buildPythonWorkspaceFiles(snapshotFiles: Map<string, Uint8Array>): PythonWorkspaceFile[] {
  return Array.from(snapshotFiles.entries())
    .map(([path, bytes]) => ({ path, contentBase64: encodeBytesToBase64(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function buildJavaScriptWorkspaceFiles(
  snapshotFiles: Map<string, Uint8Array>,
): Array<{ path: string; content: string }> {
  return Array.from(snapshotFiles.entries())
    .map(([path, bytes]) => ({ path, content: WORKSPACE_TEXT_DECODER.decode(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function preparePythonWorkspaceExecution(
  conversationId: string,
  safePath?: string,
  fallbackConversationId?: string,
): Promise<{ files: PythonWorkspaceFile[]; packages: string[] }> {
  const snapshotFiles = new Map<string, Uint8Array>();
  const usage = { fileCount: 0, totalBytes: 0 };

  await collectWorkspaceSnapshotWithFallback(
    conversationId,
    fallbackConversationId,
    snapshotFiles,
    usage,
    {
      maxFiles: PYTHON_WORKSPACE_MAX_FILES,
      maxBytes: PYTHON_WORKSPACE_MAX_BYTES,
      label: 'Python workspace snapshot',
    },
  );

  const scriptSource = safePath
    ? await readConversationWorkspaceFile(conversationId, safePath, fallbackConversationId)
    : '';
  return {
    files: buildPythonWorkspaceFiles(snapshotFiles),
    packages: scriptSource ? extractPep723Dependencies(scriptSource) : [],
  };
}

export async function prepareJavaScriptWorkspaceExecution(
  conversationId: string,
  fallbackConversationId?: string,
): Promise<Array<{ path: string; content: string }>> {
  const snapshotFiles = new Map<string, Uint8Array>();
  const usage = { fileCount: 0, totalBytes: 0 };

  await collectWorkspaceSnapshotWithFallback(
    conversationId,
    fallbackConversationId,
    snapshotFiles,
    usage,
    {
      maxFiles: JAVASCRIPT_WORKSPACE_MAX_FILES,
      maxBytes: JAVASCRIPT_WORKSPACE_MAX_BYTES,
      label: 'JavaScript workspace snapshot',
    },
  );

  return buildJavaScriptWorkspaceFiles(snapshotFiles);
}

export async function persistJavaScriptWorkspaceChanges(
  conversationId: string,
  changedFiles: Array<{ path: string; content: string }>,
  deletedPaths: string[],
): Promise<void> {
  if (changedFiles.length === 0 && deletedPaths.length === 0) {
    return;
  }

  const workspaceDir = getWorkspaceDir(conversationId);
  await ensureWorkspaceDir(workspaceDir);

  for (const path of deletedPaths) {
    const safePath = sanitizeToolWorkspacePath(path);
    if (!safePath) {
      throw new Error('JavaScript returned an invalid workspace file path.');
    }

    const file = new File(workspaceDir, safePath);
    if (file.exists) {
      file.delete();
    }
  }

  for (const file of changedFiles) {
    const safePath = sanitizeToolWorkspacePath(file.path);
    if (!safePath) {
      throw new Error('JavaScript returned an invalid workspace file path.');
    }

    const parentPath = getParentWorkspacePath(safePath);
    if (parentPath) {
      await ensureWorkspaceDir(new Directory(workspaceDir, parentPath));
    }

    new File(workspaceDir, safePath).write(file.content);
  }
}

export async function persistPythonWorkspaceFiles(
  conversationId: string,
  files: PythonWorkspaceFile[],
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const workspaceDir = getWorkspaceDir(conversationId);
  await ensureWorkspaceDir(workspaceDir);

  for (const file of files) {
    const safePath = sanitizeToolWorkspacePath(file.path);
    if (!safePath) {
      throw new Error('Python returned an invalid workspace file path.');
    }

    const parentPath = getParentWorkspacePath(safePath);
    if (parentPath) {
      await ensureWorkspaceDir(new Directory(workspaceDir, parentPath));
    }

    new File(workspaceDir, safePath).write(decodeBase64ToBytes(file.contentBase64));
  }
}
