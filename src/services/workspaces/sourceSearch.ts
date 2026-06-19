import type { WorkspaceSource } from './source';
import { listWorkspaceSourceDirectory } from './sourceFiles';

export async function listWorkspaceSourceTree(
  source: WorkspaceSource,
  basePath = '',
): Promise<string[]> {
  const results: string[] = [];

  async function visit(currentRelativePath = ''): Promise<void> {
    const currentPath = [basePath, currentRelativePath].filter(Boolean).join('/');
    const directory = await listWorkspaceSourceDirectory(source, currentPath);

    for (const entry of directory.entries) {
      const relativePath = currentRelativePath
        ? `${currentRelativePath}/${entry.name}`
        : entry.name;

      if (entry.isDirectory) {
        results.push(`${relativePath}/`);
        await visit(relativePath);
        continue;
      }

      results.push(relativePath);
    }
  }

  await visit('');
  return results;
}
