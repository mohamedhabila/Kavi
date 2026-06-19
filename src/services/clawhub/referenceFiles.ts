import type { SkillInstallSpec } from '../skills/types';
import { normalizeSkillRelativePath } from '../skills/storage';

const COMMON_SKILL_REFERENCE_FILES = ['REFERENCE.md', 'EXAMPLES.md', 'FORMS.md', 'README.md'];
const TEXT_LIKE_SKILL_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'yaml',
  'yml',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'sh',
  'bash',
  'zsh',
  'sql',
  'csv',
  'xml',
  'html',
  'css',
  'svg',
]);
const MAX_REFERENCED_SKILL_FILES = 40;
const MAX_REFERENCED_SKILL_DEPTH = 3;
const MAX_REFERENCED_SKILL_BYTES = 512 * 1024;

function isTextLikeSkillPath(relativePath: string): boolean {
  const filename = relativePath.split('/').pop() || '';
  if (!filename.includes('.')) {
    return false;
  }

  return TEXT_LIKE_SKILL_EXTENSIONS.has(filename.split('.').pop()?.toLowerCase() || '');
}

function shouldRecurseSkillReference(relativePath: string): boolean {
  return /\.(md|markdown|txt|html)$/i.test(relativePath);
}

function extractRelativeSkillReferences(content: string): string[] {
  const references = new Set<string>();
  const patterns = [
    /!?\[[^\]]*\]\(([^)]+)\)/g,
    /(?:href|src)=["']([^"']+)["']/gi,
    /`([^`]+\.(?:md|markdown|txt|json|ya?ml|js|mjs|cjs|ts|tsx|jsx|py|sh|sql|csv|xml|html|css|svg))`/gi,
    /(?:^|[^A-Za-z0-9_./-])((?:\.[/])?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:md|markdown|txt|json|ya?ml|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|sql|csv|xml|html|css|svg))(?![A-Za-z0-9_./-])/gim,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const rawCandidate = String(match[1] || '').trim();
      if (
        !rawCandidate ||
        rawCandidate.startsWith('/') ||
        /^([a-z]+:)?\/\//i.test(rawCandidate) ||
        /^[A-Za-z]:[\\/]/.test(rawCandidate)
      ) {
        continue;
      }
      const candidate = normalizeSkillRelativePath(rawCandidate);
      if (candidate && isTextLikeSkillPath(candidate)) {
        references.add(candidate);
      }
    }
  }

  for (const hint of COMMON_SKILL_REFERENCE_FILES) {
    if (content.includes(hint)) {
      references.add(hint);
    }
  }

  references.delete('SKILL.md');
  return Array.from(references);
}

function resolveReferencedSkillUrl(sourceUrl: string, relativePath: string): string | null {
  try {
    const normalizedPath = normalizeSkillRelativePath(relativePath);
    if (!normalizedPath) {
      return null;
    }

    const parsedUrl = new URL(sourceUrl);
    if (/\/api\/v1\/skills\/[^/]+\/file$/i.test(parsedUrl.pathname)) {
      parsedUrl.searchParams.set('path', normalizedPath);
      return parsedUrl.toString();
    }

    return new URL(normalizedPath, parsedUrl).toString();
  } catch {
    return null;
  }
}

export async function fetchReferencedSkillFiles(
  skillContent: string,
  source: SkillInstallSpec,
): Promise<Record<string, string>> {
  const files: Record<string, string> = { 'SKILL.md': skillContent };
  if (!source.url) {
    return files;
  }

  const seen = new Set<string>();
  const queue = extractRelativeSkillReferences(skillContent).map((relativePath) => ({
    relativePath,
    depth: 1,
  }));
  let totalBytes = skillContent.length;

  while (queue.length > 0 && Object.keys(files).length < MAX_REFERENCED_SKILL_FILES) {
    const next = queue.shift();
    if (!next) {
      break;
    }

    const normalizedPath = normalizeSkillRelativePath(next.relativePath);
    if (!normalizedPath || seen.has(normalizedPath) || !isTextLikeSkillPath(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);

    const referencedUrl = resolveReferencedSkillUrl(source.url, normalizedPath);
    if (!referencedUrl) {
      continue;
    }

    try {
      const res = await fetch(referencedUrl, {
        headers: { Accept: 'text/markdown, text/plain, application/json' },
      });
      if (!res.ok) {
        continue;
      }

      const body = await res.text();
      if (!body || totalBytes + body.length > MAX_REFERENCED_SKILL_BYTES) {
        continue;
      }

      files[normalizedPath] = body;
      totalBytes += body.length;

      if (next.depth < MAX_REFERENCED_SKILL_DEPTH && shouldRecurseSkillReference(normalizedPath)) {
        for (const nestedPath of extractRelativeSkillReferences(body)) {
          if (!seen.has(nestedPath)) {
            queue.push({ relativePath: nestedPath, depth: next.depth + 1 });
          }
        }
      }
    } catch {
      // Best-effort sidecar sync.
    }
  }

  return files;
}
