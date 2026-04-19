// ---------------------------------------------------------------------------
// Kavi— ClawHub Registry Client
// ---------------------------------------------------------------------------
// HTTP client for the ClawHub skill registry. Provides search, install,
// update, and discovery of community skills.

import type { ClawHubListResult, ClawHubSkill, ClawHubSearchResult } from '../../types';
import type { SkillMetadata, SkillEntry, SkillInstallSpec, SkillHookSpec } from '../skills/types';
import { useSkillsStore } from '../skills/manager';
import { normalizeSkillRelativePath, saveManagedSkillBundle } from '../skills/storage';
import { generateId } from '../../utils/id';
import {
  parseFrontmatterBlock,
  getFrontmatterString,
  normalizeStringList,
} from '../markdown/frontmatter';
import { buildSkillMetadataFromFrontmatter, getSkillCompatibility } from '../skills/manifest';
import { analyzeBundledPythonSkill } from '../skills/mobileTranslator';
import { unzipSync } from 'fflate';
import YAML from 'yaml';

// ── Configuration ────────────────────────────────────────────────────────

const CLAWHUB_BASE_URL = 'https://clawhub.ai/api/v1';
const CLAWHUB_SITE_URL = 'https://clawhub.ai';
const CLAWHUB_CONVEX_URL_FALLBACK = 'https://wry-manatee-359.convex.cloud';
const REQUEST_TIMEOUT = 15000;
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
const TEXT_LIKE_CONTENT_TYPES = [
  'text/',
  'application/json',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/xml',
  'image/svg+xml',
];
const MAX_REFERENCED_SKILL_FILES = 40;
const MAX_REFERENCED_SKILL_DEPTH = 3;
const MAX_REFERENCED_SKILL_BYTES = 512 * 1024;

type ClawHubSearchPayload = {
  results?: ClawHubPublicSearchEntry[];
};

type ClawHubPublicSearchEntry = {
  score?: number;
  slug?: string;
  displayName?: string;
  summary?: string | null;
  version?: string | null;
  updatedAt?: number;
};

type ClawHubBrowseEntry = {
  skill?: any;
  latestVersion?: any;
  owner?: any;
  ownerHandle?: string | null;
};

type ClawHubBrowsePayload = {
  page?: ClawHubBrowseEntry[];
  hasMore?: boolean;
  nextCursor?: string | null;
};

type ClawHubConvexQueryResponse<T> =
  | { status: 'success'; value: T }
  | { status: 'error'; errorMessage?: string };

type ClawHubDetailPayload = {
  skill?: any;
  latestVersion?: any;
};

type ClawHubVersionFile = {
  path: string;
  size?: number;
  sha256?: string;
  contentType?: string | null;
};

type ClawHubVersionPayload = {
  version?: {
    version?: string;
    files?: ClawHubVersionFile[];
  };
};

type SkillBundleFiles = {
  textFiles: Record<string, string>;
  binaryFiles: Record<string, Uint8Array>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => Boolean(value && value.trim()))
        .map((value) => value.trim()),
    ),
  );
}

let cachedClawHubConvexUrl: string | null = null;

function isPublishedSkillVersion(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }

  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.trim());
}

function extractPublishedSkillVersion(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return isPublishedSkillVersion(value) ? value : undefined;
  }

  if (isRecord(value) && typeof value.version === 'string') {
    return isPublishedSkillVersion(value.version) ? value.version : undefined;
  }

  return undefined;
}

function isTextLikeContentType(contentType: string | null | undefined): boolean {
  if (!contentType) {
    return false;
  }

  return TEXT_LIKE_CONTENT_TYPES.some((candidate) =>
    contentType.toLowerCase().startsWith(candidate),
  );
}

function isTextLikeSkillPath(relativePath: string): boolean {
  const filename = relativePath.split('/').pop() || '';
  if (!filename.includes('.')) {
    return false;
  }

  const extension = filename.split('.').pop()?.toLowerCase() || '';
  return TEXT_LIKE_SKILL_EXTENSIONS.has(extension);
}

function isTextLikeSkillBundleFile(relativePath: string, contentType?: string | null): boolean {
  return (
    relativePath === 'SKILL.md' ||
    isTextLikeContentType(contentType) ||
    isTextLikeSkillPath(relativePath)
  );
}

function createSkillBundleFiles(): SkillBundleFiles {
  return {
    textFiles: {},
    binaryFiles: {},
  };
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

async function fetchReferencedSkillFiles(
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

function buildClawHubDownloadPath(slug: string, version?: string): string {
  const params = new URLSearchParams({ slug });
  if (version) {
    params.set('version', version);
  }
  return `/download?${params.toString()}`;
}

function buildClawHubVersionPath(slug: string, version: string): string {
  return `/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`;
}

function buildClawHubFilePath(slug: string, relativePath: string, version?: string): string {
  const params = new URLSearchParams({ path: relativePath });
  if (version) {
    params.set('version', version);
  }
  return `/skills/${encodeURIComponent(slug)}/file?${params.toString()}`;
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

async function getClawHubVersionFiles(
  slug: string,
  version: string,
): Promise<ClawHubVersionFile[]> {
  const res = await clawHubFetch(buildClawHubVersionPath(slug, version));
  if (!res.ok) {
    throw new Error(`Failed to fetch skill version metadata: HTTP ${res.status}`);
  }

  const payload = (await res.json()) as ClawHubVersionPayload;
  return Array.isArray(payload.version?.files) ? payload.version.files : [];
}

async function fetchClawHubRawSkillFile(
  slug: string,
  version: string,
  relativePath: string,
): Promise<string> {
  const res = await clawHubFetch(buildClawHubFilePath(slug, relativePath, version), {
    headers: {
      Accept: 'text/markdown, text/plain, application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch skill file ${relativePath}: HTTP ${res.status}`);
  }

  return res.text();
}

async function fetchClawHubBundleFiles(slug: string, version: string): Promise<SkillBundleFiles> {
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
      if (!file.path) {
        continue;
      }

      const normalizedPath = normalizeClawHubBundlePath(file.path, canonicalSkillPath);
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
      const fallbackSkillPath = canonicalSkillPath || 'SKILL.md';
      bundle.textFiles['SKILL.md'] = await fetchClawHubRawSkillFile(
        slug,
        version,
        fallbackSkillPath,
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

function parseInstalledSkillData(
  content: string,
  fallback: Partial<ClawHubSkill>,
  metadataBase: Partial<SkillMetadata> = {},
  bundleFiles?: Record<string, string>,
): { metadata: SkillMetadata; systemPrompt?: string; hooks?: SkillHookSpec[] } | { error: string } {
  const { metadata, content: body } = parseFrontmatterBlock(content);
  let parsedRaw: Record<string, unknown> | undefined;

  try {
    const rawMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
    const nextParsed = rawMatch ? YAML.parse(rawMatch[1]) : undefined;
    if (isRecord(nextParsed)) {
      parsedRaw = nextParsed;
    }
  } catch {
    parsedRaw = undefined;
  }

  const rawLegacyMetadata = (parsedRaw as any)?.metadata?.openclaw;
  const parsedLegacyMetadata = (metadata as any)?.metadata?.openclaw ?? (metadata as any)?.openclaw;
  const legacyMetadata = rawLegacyMetadata ?? parsedLegacyMetadata;
  const legacyPrimaryEnv =
    typeof legacyMetadata?.primaryEnv === 'string'
      ? legacyMetadata.primaryEnv.trim() || undefined
      : undefined;
  const legacySkillKey =
    typeof legacyMetadata?.skillKey === 'string'
      ? legacyMetadata.skillKey.trim() || undefined
      : undefined;
  const legacyRequiredEnv = normalizeStringList(legacyMetadata?.requires?.env);
  const skillMetadata = buildSkillMetadataFromFrontmatter(metadata, {
    ...metadataBase,
    name: fallback.name || metadataBase.name,
    description: fallback.description || metadataBase.description,
    version: fallback.version || metadataBase.version || '0.0.0',
    author: fallback.author || metadataBase.author,
    tags: fallback.tags || metadataBase.tags,
    primaryEnv: legacyPrimaryEnv || metadataBase.primaryEnv,
    skillKey: legacySkillKey || metadataBase.skillKey,
  });

  if (!skillMetadata) {
    return { error: 'Skill manifest is missing a name.' };
  }

  const bundledPython = bundleFiles ? analyzeBundledPythonSkill(content, bundleFiles) : undefined;
  if (bundledPython) {
    skillMetadata.bundledPython = bundledPython;
  }

  if (legacyPrimaryEnv || legacySkillKey || legacyRequiredEnv.length > 0) {
    skillMetadata.skillKey = skillMetadata.skillKey || legacySkillKey;
    skillMetadata.primaryEnv = skillMetadata.primaryEnv || legacyPrimaryEnv;
    if (legacyRequiredEnv.length > 0) {
      skillMetadata.requires = {
        ...skillMetadata.requires,
        env: uniqueStrings([...(skillMetadata.requires?.env || []), ...legacyRequiredEnv]),
      };
    }
    skillMetadata.requiredSecrets = uniqueStrings([
      ...(skillMetadata.requiredSecrets || []),
      skillMetadata.primaryEnv,
      ...legacyRequiredEnv,
    ]);
  }

  return {
    metadata: skillMetadata,
    systemPrompt: body.trim() || undefined,
    hooks: parseSkillHooks(metadata.hooks),
  };
}

async function installSkillFromBundleFiles(
  bundleFiles: SkillBundleFiles,
  source: SkillInstallSpec,
  fallback: Partial<ClawHubSkill> = {},
): Promise<SkillInstallResult> {
  const content = bundleFiles.textFiles['SKILL.md'];
  if (!content) {
    return { success: false, error: 'Skill bundle is missing SKILL.md.' };
  }

  const parsed = parseInstalledSkillData(content, fallback, {}, bundleFiles.textFiles);
  if ('error' in parsed) {
    return { success: false, error: parsed.error };
  }

  const compatibility = getSkillCompatibility(parsed.metadata);
  if (!compatibility.compatible) {
    return {
      success: false,
      error: compatibility.reason || 'This skill is not compatible with mobile.',
    };
  }

  const entry: SkillEntry = {
    id: generateId(),
    metadata: parsed.metadata,
    enabled: true,
    installedAt: Date.now(),
    source,
    systemPrompt: parsed.systemPrompt,
    hooks: parsed.hooks,
  };

  const managedEntry = await saveManagedSkillBundle(
    entry,
    bundleFiles.textFiles,
    bundleFiles.binaryFiles,
  );
  useSkillsStore.getState().addEntry(managedEntry);
  return { success: true, skillEntry: managedEntry };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────

async function clawHubFetch(path: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const headers = new Headers(options?.headers || undefined);
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'Kavi/1.0');
    }
    if (options?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(`${CLAWHUB_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

function extractClawHubMainBundlePath(html: string): string | null {
  const preloadMatch = html.match(/<link[^>]+href=["']([^"']*\/assets\/main-[^"']+\.js)["']/i);
  if (preloadMatch?.[1]) {
    return preloadMatch[1];
  }

  const importMatch = html.match(/import\(["']([^"']*\/assets\/main-[^"']+\.js)["']\)/i);
  return importMatch?.[1] || null;
}

function extractClawHubConvexUrl(bundleSource: string): string | null {
  const match = bundleSource.match(/VITE_CONVEX_URL:\s*["']([^"']+)["']/);
  return match?.[1] || null;
}

async function discoverClawHubConvexUrl(): Promise<string> {
  const siteResponse = await fetch(`${CLAWHUB_SITE_URL}/skills?nonSuspicious=true`, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Kavi/1.0',
    },
  });

  if (!siteResponse.ok) {
    throw new Error(`Failed to load ClawHub skills page: HTTP ${siteResponse.status}`);
  }

  const siteHtml = await siteResponse.text();
  const bundlePath = extractClawHubMainBundlePath(siteHtml);
  if (!bundlePath) {
    throw new Error('Unable to locate the ClawHub web bundle.');
  }

  const bundleUrl = new URL(bundlePath, CLAWHUB_SITE_URL).toString();
  const bundleResponse = await fetch(bundleUrl, {
    headers: {
      Accept: 'application/javascript, text/javascript, text/plain',
      'User-Agent': 'Kavi/1.0',
    },
  });

  if (!bundleResponse.ok) {
    throw new Error(`Failed to load ClawHub web bundle: HTTP ${bundleResponse.status}`);
  }

  const bundleSource = await bundleResponse.text();
  const convexUrl = extractClawHubConvexUrl(bundleSource);
  if (!convexUrl) {
    throw new Error('Unable to extract the ClawHub Convex deployment URL.');
  }

  cachedClawHubConvexUrl = convexUrl;
  return convexUrl;
}

async function getClawHubConvexUrl(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    return cachedClawHubConvexUrl || CLAWHUB_CONVEX_URL_FALLBACK;
  }

  try {
    return await discoverClawHubConvexUrl();
  } catch {
    return cachedClawHubConvexUrl || CLAWHUB_CONVEX_URL_FALLBACK;
  }
}

async function queryClawHubBrowsePage(
  args: {
    cursor?: string;
    numItems?: number;
    sort?: 'newest' | 'updated' | 'downloads' | 'installs' | 'stars' | 'name';
    dir?: 'asc' | 'desc';
    highlightedOnly?: boolean;
    nonSuspiciousOnly?: boolean;
  },
  options: { retryWithDiscovery?: boolean } = {},
): Promise<ClawHubBrowsePayload> {
  const { retryWithDiscovery = true } = options;
  const convexUrl = await getClawHubConvexUrl(false);
  const response = await fetch(`${convexUrl}/api/query`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Kavi/1.0',
    },
    body: JSON.stringify({
      path: 'skills:listPublicPageV4',
      args,
    }),
  });

  if (!response.ok) {
    if (retryWithDiscovery) {
      await getClawHubConvexUrl(true);
      return queryClawHubBrowsePage(args, { retryWithDiscovery: false });
    }
    throw new Error(`Failed to fetch ClawHub browse page: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ClawHubConvexQueryResponse<ClawHubBrowsePayload>;
  if (payload.status !== 'success') {
    if (retryWithDiscovery) {
      await getClawHubConvexUrl(true);
      return queryClawHubBrowsePage(args, { retryWithDiscovery: false });
    }
    throw new Error(payload.errorMessage || 'ClawHub browse query failed.');
  }

  return payload.value;
}

// ── Search ───────────────────────────────────────────────────────────────

export async function searchClawHub(
  query: string,
  options: { page?: number; pageSize?: number; tags?: string[] } = {},
): Promise<ClawHubSearchResult> {
  const { page = 1, pageSize = 20, tags = [] } = options;
  const limit = Math.max(page, 1) * Math.max(pageSize, 1);

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  if (tags.length > 0) {
    params.set('tags', tags.join(','));
  }

  try {
    const res = await clawHubFetch(`/search?${params.toString()}`);

    if (!res.ok) {
      return { skills: [], total: 0, page, pageSize };
    }

    const data = (await res.json()) as ClawHubSearchPayload;
    return {
      skills: (data.results || []).map(mapClawHubSkill),
      total: data.results?.length || 0,
      page,
      pageSize,
    };
  } catch {
    return { skills: [], total: 0, page, pageSize };
  }
}

export async function listClawHubSkills(
  options: {
    limit?: number;
    cursor?: string | null;
    sort?: 'downloads' | 'trending';
    nonSuspiciousOnly?: boolean;
  } = {},
): Promise<ClawHubListResult> {
  const { limit = 20, cursor, sort = 'downloads', nonSuspiciousOnly = true } = options;

  try {
    const browseSort = sort === 'trending' ? 'installs' : 'downloads';
    const data = await queryClawHubBrowsePage({
      cursor: cursor || undefined,
      numItems: limit,
      sort: browseSort,
      dir: 'desc',
      nonSuspiciousOnly,
    });

    return {
      skills: (data.page || []).map(mapClawHubSkill),
      nextCursor: data.hasMore ? data.nextCursor || null : null,
    };
  } catch {
    return { skills: [], nextCursor: null };
  }
}

// ── Featured / Popular ───────────────────────────────────────────────────

export async function getFeaturedSkills(): Promise<ClawHubSkill[]> {
  const result = await listClawHubSkills({ limit: 20, sort: 'downloads' });
  return result.skills;
}

export async function getPopularSkills(limit = 20): Promise<ClawHubSkill[]> {
  const result = await listClawHubSkills({ limit, sort: 'trending' });
  return result.skills;
}

// ── Skill detail ─────────────────────────────────────────────────────────

export async function getSkillDetail(skillId: string): Promise<ClawHubSkill | null> {
  try {
    const res = await clawHubFetch(`/skills/${encodeURIComponent(skillId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as ClawHubDetailPayload;
    return mapClawHubSkill(data);
  } catch {
    return null;
  }
}

// ── Install ──────────────────────────────────────────────────────────────

export interface SkillInstallResult {
  success: boolean;
  skillEntry?: SkillEntry;
  error?: string;
}

async function installSkillFromContent(
  content: string,
  source: SkillInstallSpec,
  fallback: Partial<ClawHubSkill> = {},
): Promise<SkillInstallResult> {
  const bundleFiles = await fetchReferencedSkillFiles(content, source);
  return installSkillFromBundleFiles({ textFiles: bundleFiles, binaryFiles: {} }, source, fallback);
}

function parseClawHubSkillFileUrl(
  url: string,
): { slug: string; version?: string; path: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'clawhub.ai') {
      return null;
    }

    const match = parsed.pathname.match(/^\/api\/v1\/skills\/([^/]+)\/file$/i);
    if (!match?.[1]) {
      return null;
    }

    return {
      slug: decodeURIComponent(match[1]),
      version: parsed.searchParams.get('version') || undefined,
      path: parsed.searchParams.get('path') || 'SKILL.md',
    };
  } catch {
    return null;
  }
}

async function installClawHubSkillBundle(
  slug: string,
  version: string,
  fallback: Partial<ClawHubSkill> = {},
): Promise<SkillInstallResult> {
  const bundleFiles = await fetchClawHubBundleFiles(slug, version);
  return installSkillFromBundleFiles(
    bundleFiles,
    {
      source: 'clawhub',
      id: slug,
      url: buildClawHubFilePath(slug, 'SKILL.md'),
      version,
    },
    fallback,
  );
}

export async function installSkillFromUrl(url: string): Promise<SkillInstallResult> {
  const clawHubFileUrl = parseClawHubSkillFileUrl(url);
  if (clawHubFileUrl && /^(?:skill|skills)\.md$/i.test(clawHubFileUrl.path)) {
    try {
      const detail = await getSkillDetail(clawHubFileUrl.slug);
      const version = clawHubFileUrl.version || detail?.version;
      if (!version) {
        return { success: false, error: 'ClawHub did not provide a skill version.' };
      }
      return installClawHubSkillBundle(
        clawHubFileUrl.slug,
        version,
        detail || { id: clawHubFileUrl.slug },
      );
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/markdown, text/plain, application/json' },
    });

    if (!res.ok) {
      return { success: false, error: `Failed to fetch skill: HTTP ${res.status}` };
    }

    const content = await res.text();
    return installSkillFromContent(content, {
      source: 'url',
      url,
    });
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function installSkillFromHub(skill: ClawHubSkill): Promise<SkillInstallResult> {
  try {
    const version = isPublishedSkillVersion(skill.version)
      ? skill.version
      : (await getSkillDetail(skill.id))?.version;
    if (!version) {
      return { success: false, error: 'ClawHub did not provide a skill version.' };
    }

    return installClawHubSkillBundle(skill.id, version, skill);
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Update ───────────────────────────────────────────────────────────────

/**
 * Update an installed skill to the latest version from ClawHub.
 * Fetches the new manifest, updates metadata, and preserves the entry ID.
 */
export async function updateSkillFromHub(
  entry: SkillEntry,
  latestVersion: string,
): Promise<SkillInstallResult> {
  if (entry.source.source !== 'clawhub') {
    return { success: false, error: 'Skill was not installed from ClawHub' };
  }

  if (!entry.source.id) {
    return { success: false, error: 'ClawHub skill ID is unavailable.' };
  }

  try {
    let bundleFiles: SkillBundleFiles;
    let parsed = null as ReturnType<typeof parseInstalledSkillData> | null;

    try {
      bundleFiles = await fetchClawHubBundleFiles(entry.source.id, latestVersion);
      parsed = parseInstalledSkillData(
        bundleFiles.textFiles['SKILL.md'],
        {
          name: entry.metadata.name,
          description: entry.metadata.description,
          version: latestVersion,
          author: entry.metadata.author,
          tags: entry.metadata.tags,
        },
        {
          ...entry.metadata,
          version: latestVersion,
        },
        bundleFiles.textFiles,
      );
    } catch {
      const content = await fetchClawHubRawSkillFile(entry.source.id, latestVersion, 'SKILL.md');
      bundleFiles = {
        textFiles: await fetchReferencedSkillFiles(content, {
          ...entry.source,
          version: latestVersion,
          url: buildClawHubFilePath(entry.source.id, 'SKILL.md'),
        }),
        binaryFiles: {},
      };
      parsed = parseInstalledSkillData(
        content,
        {
          name: entry.metadata.name,
          description: entry.metadata.description,
          version: latestVersion,
          author: entry.metadata.author,
          tags: entry.metadata.tags,
        },
        {
          ...entry.metadata,
          version: latestVersion,
        },
        bundleFiles.textFiles,
      );
    }

    if (!parsed || 'error' in parsed) {
      return {
        success: false,
        error: parsed?.error || 'Updated skill manifest is missing a name.',
      };
    }

    const compatibility = getSkillCompatibility(parsed.metadata);
    if (!compatibility.compatible) {
      return {
        success: false,
        error: compatibility.reason || 'Updated skill is not compatible with mobile.',
      };
    }

    const updatedEntry = await saveManagedSkillBundle(
      {
        ...entry,
        metadata: parsed.metadata,
        source: {
          ...entry.source,
          url: buildClawHubFilePath(entry.source.id, 'SKILL.md'),
          version: latestVersion,
        },
        systemPrompt: parsed.systemPrompt || entry.systemPrompt,
        hooks: parsed.hooks || entry.hooks,
      },
      bundleFiles.textFiles,
      bundleFiles.binaryFiles,
    );

    useSkillsStore.getState().updateEntry(entry.id, {
      metadata: updatedEntry.metadata,
      source: updatedEntry.source,
      systemPrompt: updatedEntry.systemPrompt,
      hooks: updatedEntry.hooks,
    });

    return {
      success: true,
      skillEntry: updatedEntry,
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function refreshSkillEntryFromSource(entry: SkillEntry): Promise<SkillInstallResult> {
  if (entry.source.source === 'clawhub' && entry.source.id) {
    const version = entry.source.version || entry.metadata.version;

    try {
      let bundleFiles: SkillBundleFiles;
      let parsed = null as ReturnType<typeof parseInstalledSkillData> | null;

      try {
        bundleFiles = await fetchClawHubBundleFiles(entry.source.id, version);
        parsed = parseInstalledSkillData(
          bundleFiles.textFiles['SKILL.md'],
          {
            name: entry.metadata.name,
            description: entry.metadata.description,
            version,
            author: entry.metadata.author,
            tags: entry.metadata.tags,
          },
          entry.metadata,
          bundleFiles.textFiles,
        );
      } catch {
        const content = await fetchClawHubRawSkillFile(entry.source.id, version, 'SKILL.md');
        bundleFiles = {
          textFiles: await fetchReferencedSkillFiles(content, {
            ...entry.source,
            url: buildClawHubFilePath(entry.source.id, 'SKILL.md'),
            version,
          }),
          binaryFiles: {},
        };
        parsed = parseInstalledSkillData(
          content,
          {
            name: entry.metadata.name,
            description: entry.metadata.description,
            version,
            author: entry.metadata.author,
            tags: entry.metadata.tags,
          },
          entry.metadata,
          bundleFiles.textFiles,
        );
      }

      if (!parsed || 'error' in parsed) {
        return { success: false, error: parsed?.error || 'Skill manifest is missing a name.' };
      }

      const compatibility = getSkillCompatibility(parsed.metadata);
      if (!compatibility.compatible) {
        return {
          success: false,
          error: compatibility.reason || 'Skill is not compatible with mobile.',
        };
      }

      const managedEntry = await saveManagedSkillBundle(
        {
          ...entry,
          metadata: parsed.metadata,
          source: {
            ...entry.source,
            url: buildClawHubFilePath(entry.source.id, 'SKILL.md'),
            version,
          },
          systemPrompt: parsed.systemPrompt || entry.systemPrompt,
          hooks: parsed.hooks || entry.hooks,
        },
        bundleFiles.textFiles,
        bundleFiles.binaryFiles,
      );

      useSkillsStore.getState().updateEntry(entry.id, {
        metadata: managedEntry.metadata,
        source: managedEntry.source,
        systemPrompt: managedEntry.systemPrompt,
        hooks: managedEntry.hooks,
      });

      return { success: true, skillEntry: managedEntry };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!entry.source.url) {
    return { success: false, error: 'Skill source URL is unavailable.' };
  }

  try {
    const res = await fetch(entry.source.url, {
      headers: { Accept: 'text/markdown, application/json' },
    });

    if (!res.ok) {
      return { success: false, error: `Failed to refresh skill: HTTP ${res.status}` };
    }

    const content = await res.text();
    const bundleFiles = await fetchReferencedSkillFiles(content, entry.source);
    const parsed = parseInstalledSkillData(
      content,
      {
        name: entry.metadata.name,
        description: entry.metadata.description,
        version: entry.metadata.version,
        author: entry.metadata.author,
        tags: entry.metadata.tags,
      },
      entry.metadata,
      bundleFiles,
    );
    if ('error' in parsed) {
      return { success: false, error: parsed.error };
    }

    const compatibility = getSkillCompatibility(parsed.metadata);
    if (!compatibility.compatible) {
      return {
        success: false,
        error: compatibility.reason || 'Skill is not compatible with mobile.',
      };
    }

    const nextEntry: SkillEntry = {
      ...entry,
      metadata: parsed.metadata,
      systemPrompt: parsed.systemPrompt || entry.systemPrompt,
      hooks: parsed.hooks || entry.hooks,
    };
    const managedEntry = await saveManagedSkillBundle(nextEntry, bundleFiles);

    useSkillsStore.getState().updateEntry(entry.id, {
      metadata: managedEntry.metadata,
      source: managedEntry.source,
      systemPrompt: managedEntry.systemPrompt,
      hooks: managedEntry.hooks,
    });

    return { success: true, skillEntry: managedEntry };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Update check ─────────────────────────────────────────────────────────

export async function checkForUpdates(
  installedSkills: SkillEntry[],
): Promise<Array<{ entry: SkillEntry; latestVersion: string }>> {
  const updates: Array<{ entry: SkillEntry; latestVersion: string }> = [];

  for (const entry of installedSkills) {
    if (entry.source.source !== 'clawhub' || !entry.source.id) continue;

    try {
      const detail = await getSkillDetail(entry.source.id);
      if (detail && detail.version !== entry.metadata.version) {
        updates.push({ entry, latestVersion: detail.version });
      }
    } catch {
      // Skip failed checks
    }
  }

  return updates;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function mapClawHubSkill(raw: any): ClawHubSkill {
  const skill = raw.skill || raw;
  const latestVersion = raw.latestVersion || raw.version || null;
  const slug = skill.slug || raw.slug || raw.id || raw.name || '';
  const version =
    extractPublishedSkillVersion(latestVersion) || extractPublishedSkillVersion(raw.version) || '';

  return {
    id: slug,
    name: skill.displayName || raw.displayName || raw.name || slug,
    description: skill.summary || raw.summary || raw.description || '',
    version,
    author: raw.owner?.displayName || raw.owner?.handle || raw.ownerHandle || raw.author || '',
    tags: Object.keys(skill.tags || raw.tags || {}),
    downloads: Number(skill.stats?.downloads || raw.downloads) || 0,
    rating: Number(skill.stats?.stars || raw.rating) || 0,
    installUrl:
      raw.installUrl ||
      raw.install_url ||
      `${CLAWHUB_BASE_URL}/skills/${encodeURIComponent(slug)}/file?path=SKILL.md`,
  };
}

/**
 * Parse hook specs from skill metadata (if present).
 * Skills in ClawHub can define hooks as part of their frontmatter:
 * hooks:
 *   - event: session
 *     action: start
 *     prompt: "Initialize the skill context..."
 */
function parseSkillHooks(raw: unknown): SkillHookSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const hooks: SkillHookSpec[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || !item) continue;
    const event = typeof item.event === 'string' ? item.event : undefined;
    const prompt = typeof item.prompt === 'string' ? item.prompt : undefined;
    if (!event || !prompt) continue;

    hooks.push({
      event,
      action: typeof item.action === 'string' ? item.action : undefined,
      prompt,
    });
  }

  return hooks.length > 0 ? hooks : undefined;
}
