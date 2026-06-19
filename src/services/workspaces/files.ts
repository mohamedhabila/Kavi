/**
 * Workspace file operations client for code-server / OpenVSCode Server.
 *
 * Provides file read/write/list/mkdir/rename/delete operations against
 * remote workspace targets that run code-server or OpenVSCode Server.
 */

import type {
  DirectoryListResult,
  FileEntry,
  FileReadResult,
  FileWriteResult,
} from '../files/contracts';
import type { WorkspaceTargetConfig } from '../../types/remote';
import { getWorkspaceProviderFileAccessMode } from './connector';
import {
  codeServerListDirectory,
  codeServerMkdir,
  codeServerReadFile,
  codeServerWriteFile,
  customListDirectory,
  customMkdir,
  customReadFile,
  customWriteFile,
  deleteWorkspaceFileByMode,
  renameWorkspaceFileByMode,
} from './fileApi';

export type WorkspaceFileEntry = FileEntry;
export type WorkspaceFileReadResult = FileReadResult;
export type WorkspaceFileWriteResult = FileWriteResult;
export type WorkspaceDirectoryListResult = DirectoryListResult<WorkspaceFileEntry>;

type WorkspaceFileAccessMode = ReturnType<typeof getWorkspaceProviderFileAccessMode>;
type LaunchableWorkspaceFileAccessMode = Exclude<WorkspaceFileAccessMode, 'none'>;

function getWorkspaceFileAccessMode(target: WorkspaceTargetConfig): WorkspaceFileAccessMode {
  return getWorkspaceProviderFileAccessMode(target.provider);
}

function requireWorkspaceFileAccess(
  target: WorkspaceTargetConfig,
): LaunchableWorkspaceFileAccessMode {
  const mode = getWorkspaceFileAccessMode(target);
  if (mode === 'none') {
    throw new Error('Workspace target does not support file operations');
  }
  return mode;
}

export async function readWorkspaceFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<WorkspaceFileReadResult> {
  const mode = requireWorkspaceFileAccess(target);
  return mode === 'native'
    ? codeServerReadFile(target, remotePath)
    : customReadFile(target, remotePath);
}

export async function writeWorkspaceFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
  content: string,
): Promise<WorkspaceFileWriteResult> {
  const mode = requireWorkspaceFileAccess(target);
  return mode === 'native'
    ? codeServerWriteFile(target, remotePath, content)
    : customWriteFile(target, remotePath, content);
}

export async function listWorkspaceDirectory(
  target: WorkspaceTargetConfig,
  remotePath: string = '.',
): Promise<WorkspaceDirectoryListResult> {
  const mode = requireWorkspaceFileAccess(target);
  return mode === 'native'
    ? codeServerListDirectory(target, remotePath)
    : customListDirectory(target, remotePath);
}

export async function makeWorkspaceDirectory(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<void> {
  const mode = requireWorkspaceFileAccess(target);
  return mode === 'native' ? codeServerMkdir(target, remotePath) : customMkdir(target, remotePath);
}

export async function renameWorkspaceFile(
  target: WorkspaceTargetConfig,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const mode = requireWorkspaceFileAccess(target);
  await renameWorkspaceFileByMode(target, mode, oldPath, newPath);
}

export async function deleteWorkspaceFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<void> {
  const mode = requireWorkspaceFileAccess(target);
  await deleteWorkspaceFileByMode(target, mode, remotePath);
}
