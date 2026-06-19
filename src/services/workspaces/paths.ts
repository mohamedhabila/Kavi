export function sanitizeWorkspaceRelativePath(inputPath: string): string {
  let normalized = inputPath;
  try {
    normalized = decodeURIComponent(inputPath);
  } catch {
    normalized = inputPath;
  }

  normalized = normalized.replace(/\\/g, '/');
  normalized = normalized.replace(/\0/g, '');

  let previous = '';
  while (previous !== normalized) {
    previous = normalized;
    normalized = normalized.replace(/\.\.\//g, '').replace(/\.\.$/g, '');
  }

  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.trim();

  const segments = normalized
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  return segments.join('/');
}
