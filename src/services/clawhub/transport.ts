export const CLAWHUB_BASE_URL = 'https://clawhub.ai/api/v1';
export const CLAWHUB_SITE_URL = 'https://clawhub.ai';

const REQUEST_TIMEOUT = 15000;

export type ClawHubVersionFile = {
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

export function buildClawHubDownloadPath(slug: string, version?: string): string {
  const params = new URLSearchParams({ slug });
  if (version) {
    params.set('version', version);
  }
  return `/download?${params.toString()}`;
}

function buildClawHubVersionPath(slug: string, version: string): string {
  return `/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`;
}

export function buildClawHubFilePath(slug: string, relativePath: string, version?: string): string {
  const params = new URLSearchParams({ path: relativePath });
  if (version) {
    params.set('version', version);
  }
  return `/skills/${encodeURIComponent(slug)}/file?${params.toString()}`;
}

export async function clawHubFetch(path: string, options?: RequestInit): Promise<Response> {
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

    return await fetch(`${CLAWHUB_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getClawHubVersionFiles(
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

export async function fetchClawHubRawSkillFile(
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
