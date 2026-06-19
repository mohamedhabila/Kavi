import { unzipSync } from 'fflate';
import { normalizeSkillRelativePath } from '../skills/storage';
import {
  buildClawHubDownloadPath,
  buildClawHubFilePath,
  clawHubFetch,
  fetchClawHubRawSkillFile,
  getClawHubVersionFiles,
  type ClawHubVersionFile,
} from './transport';

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
const TEXT_LIKE_CONTENT_TYPES = [
  'text/',
  'application/json',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/xml',
  'image/svg+xml',
];

export type SkillBundleFiles = {
  textFiles: Record<string, string>;
  binaryFiles: Record<string, Uint8Array>;
};

function createSkillBundleFiles(): SkillBundleFiles {
  return {
    textFiles: {},
    binaryFiles: {},
  };
}

function isTextLikeContentType(contentType: string | null | undefined): boolean {
  return Boolean(
    contentType &&
    TEXT_LIKE_CONTENT_TYPES.some((candidate) => contentType.toLowerCase().startsWith(candidate)),
  );
}

function isTextLikeSkillPath(relativePath: string): boolean {
  const filename = relativePath.split('/').pop() || '';
  if (!filename.includes('.')) {
    return false;
  }

  return TEXT_LIKE_SKILL_EXTENSIONS.has(filename.split('.').pop()?.toLowerCase() || '');
}

function isTextLikeSkillBundleFile(relativePath: string, contentType?: string | null): boolean {
  return (
    relativePath === 'SKILL.md' ||
    isTextLikeContentType(contentType) ||
    isTextLikeSkillPath(relativePath)
  );
}

function getCanonicalSkillPath(paths: string[]): string | null {
  return paths.find((value) => /^(skill|skills)\.md$/i.test(value.trim())) || null;
}

function normalizeClawHubBundlePath(
  relativePath: string,
  canonicalSkillPath: string | null,
): string | null {
  if (canonicalSkillPath && relativePath.toLowerCase() === canonicalSkillPath.toLowerCase()) {
    return 'SKILL.md';
  }

  return normalizeSkillRelativePath(relativePath);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function fetchClawHubDeclaredBundleFiles(
  slug: string,
  version: string,
  versionFiles: ClawHubVersionFile[],
): Promise<SkillBundleFiles> {
  const bundle = createSkillBundleFiles();
  const canonicalSkillPath = getCanonicalSkillPath(
    versionFiles.map((file) => file.path).filter((value): value is string => Boolean(value)),
  );

  for (const file of versionFiles) {
    if (!file.path) {
      continue;
    }

    const normalizedPath = normalizeClawHubBundlePath(file.path, canonicalSkillPath);
    if (!normalizedPath) {
      continue;
    }

    const response = await clawHubFetch(buildClawHubFilePath(slug, file.path, version), {
      headers: {
        Accept: isTextLikeSkillBundleFile(normalizedPath, file.contentType)
          ? 'text/markdown, text/plain, application/json, application/octet-stream'
          : 'application/octet-stream',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch declared skill file ${file.path}: HTTP ${response.status}`);
    }

    if (isTextLikeSkillBundleFile(normalizedPath, file.contentType)) {
      bundle.textFiles[normalizedPath] = await response.text();
    } else {
      bundle.binaryFiles[normalizedPath] = new Uint8Array(await response.arrayBuffer());
    }
  }

  if (!bundle.textFiles['SKILL.md']) {
    throw new Error('Skill bundle is missing SKILL.md.');
  }

  return bundle;
}

export async function fetchClawHubBundleFiles(
  slug: string,
  version: string,
): Promise<SkillBundleFiles> {
  const versionFiles = await getClawHubVersionFiles(slug, version);

  try {
    const res = await clawHubFetch(buildClawHubDownloadPath(slug, version), {
      headers: {
        Accept: 'application/zip',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download skill bundle: HTTP ${res.status}`);
    }

    const archive = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const archiveKeyByLower = new Map<string, string>();
    for (const key of Object.keys(archive)) {
      archiveKeyByLower.set(key.toLowerCase(), key);
    }

    const filesToPersist =
      versionFiles.length > 0
        ? versionFiles
        : Object.keys(archive).map((path) => ({ path, contentType: undefined }));
    const canonicalSkillPath = getCanonicalSkillPath(
      filesToPersist.map((file) => file.path).filter((value): value is string => Boolean(value)),
    );
    const bundle = createSkillBundleFiles();

    for (const file of filesToPersist) {
      const normalizedPath = file.path && normalizeClawHubBundlePath(file.path, canonicalSkillPath);
      if (!normalizedPath) {
        continue;
      }

      const matchedArchiveKey = archiveKeyByLower.get(file.path.toLowerCase());
      if (!matchedArchiveKey) {
        if (versionFiles.length > 0) {
          throw new Error(`Downloaded skill bundle is missing ${file.path}.`);
        }
        continue;
      }

      const bytes = archive[matchedArchiveKey];
      if (isTextLikeSkillBundleFile(normalizedPath, file.contentType)) {
        try {
          bundle.textFiles[normalizedPath] = decodeUtf8(bytes);
        } catch {
          bundle.binaryFiles[normalizedPath] = bytes;
        }
      } else {
        bundle.binaryFiles[normalizedPath] = bytes;
      }
    }

    if (!bundle.textFiles['SKILL.md']) {
      if (versionFiles.length > 0) {
        throw new Error('Downloaded skill bundle is missing SKILL.md.');
      }
      bundle.textFiles['SKILL.md'] = await fetchClawHubRawSkillFile(
        slug,
        version,
        canonicalSkillPath || 'SKILL.md',
      );
    }

    return bundle;
  } catch {
    if (versionFiles.length > 0) {
      return fetchClawHubDeclaredBundleFiles(slug, version, versionFiles);
    }

    return {
      textFiles: {
        'SKILL.md': await fetchClawHubRawSkillFile(slug, version, 'SKILL.md'),
      },
      binaryFiles: {},
    };
  }
}
