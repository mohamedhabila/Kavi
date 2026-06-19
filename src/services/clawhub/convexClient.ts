import { CLAWHUB_SITE_URL } from './transport';

const CLAWHUB_CONVEX_URL_ENV = 'EXPO_PUBLIC_CLAWHUB_CONVEX_URL';

type ClawHubBrowseEntry = {
  skill?: any;
  latestVersion?: any;
  owner?: any;
  ownerHandle?: string | null;
};

export type ClawHubBrowsePayload = {
  page?: ClawHubBrowseEntry[];
  hasMore?: boolean;
  nextCursor?: string | null;
};

type ClawHubConvexQueryResponse<T> =
  | { status: 'success'; value: T }
  | { status: 'error'; errorMessage?: string };

let cachedClawHubConvexUrl: string | null = null;

function normalizeClawHubConvexUrl(value?: string | null): string | null {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getConfiguredClawHubConvexUrl(): string | null {
  return normalizeClawHubConvexUrl(process.env[CLAWHUB_CONVEX_URL_ENV]);
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

  const bundlePath = extractClawHubMainBundlePath(await siteResponse.text());
  if (!bundlePath) {
    throw new Error('Unable to locate the ClawHub web bundle.');
  }

  const bundleResponse = await fetch(new URL(bundlePath, CLAWHUB_SITE_URL).toString(), {
    headers: {
      Accept: 'application/javascript, text/javascript, text/plain',
      'User-Agent': 'Kavi/1.0',
    },
  });

  if (!bundleResponse.ok) {
    throw new Error(`Failed to load ClawHub web bundle: HTTP ${bundleResponse.status}`);
  }

  const convexUrl = extractClawHubConvexUrl(await bundleResponse.text());
  if (!convexUrl) {
    throw new Error('Unable to extract the ClawHub Convex deployment URL.');
  }

  cachedClawHubConvexUrl = convexUrl;
  return convexUrl;
}

async function getClawHubConvexUrl(forceRefresh = false): Promise<string> {
  const configuredUrl = getConfiguredClawHubConvexUrl();
  if (configuredUrl) {
    cachedClawHubConvexUrl = configuredUrl;
    return configuredUrl;
  }

  if (!forceRefresh && cachedClawHubConvexUrl) {
    return cachedClawHubConvexUrl;
  }

  try {
    return await discoverClawHubConvexUrl();
  } catch (error) {
    if (cachedClawHubConvexUrl) {
      return cachedClawHubConvexUrl;
    }
    throw error;
  }
}

export function __resetClawHubConvexDiscoveryForTests(): void {
  cachedClawHubConvexUrl = null;
}

export async function queryClawHubBrowsePage(
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
